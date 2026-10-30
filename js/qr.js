/* 字节模式、纠错等级 M 的二维码。只供分享海报使用。 */
const QR = {
  blocks: {
    1: [10, 1, 16, 0, 0],
    2: [16, 1, 28, 0, 0],
    3: [26, 1, 44, 0, 0],
    4: [18, 2, 32, 0, 0],
    5: [24, 2, 43, 0, 0],
    6: [16, 4, 27, 0, 0],
    7: [18, 4, 31, 0, 0],
    8: [22, 2, 38, 2, 39],
    9: [22, 3, 36, 2, 37],
    10: [26, 4, 43, 1, 44],
    11: [30, 1, 50, 4, 51],
    12: [22, 6, 36, 2, 37]
  },
  align: {
    2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
    11: [6, 30, 54], 12: [6, 32, 58]
  },
  formatM: [
    "101010000010010", "101000100100101", "101111001111100", "101101101001011",
    "100010111111001", "100000011001110", "100111110010111", "100101010100000"
  ],
  versionBits: {
    7: "000111110010010100",
    8: "001000010110111100",
    9: "001001101010011001",
    10: "001010010011010011",
    11: "001011101111110110",
    12: "001100011101100010"
  },
  remainder: { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 },
  exp: null,
  log: null,
  tables() {
    if (QR.exp) return;
    const exp = new Array(512);
    const log = new Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) {
      exp[i] = x;
      log[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
    QR.exp = exp;
    QR.log = log;
  },
  mul(a, b) {
    if (!a || !b) return 0;
    return QR.exp[QR.log[a] + QR.log[b]];
  },
  reedSolomon(data, eccLen) {
    QR.tables();
    let gen = [1];
    for (let i = 0; i < eccLen; i++) {
      const next = new Array(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j++) {
        next[j] ^= gen[j];
        next[j + 1] ^= QR.mul(gen[j], QR.exp[i]);
      }
      gen = next;
    }
    const msg = data.concat(new Array(eccLen).fill(0));
    for (let i = 0; i < data.length; i++) {
      const coef = msg[i];
      if (!coef) continue;
      for (let j = 0; j < gen.length; j++) msg[i + j] ^= QR.mul(gen[j], coef);
    }
    return msg.slice(data.length);
  },
  bytes(text) {
    return Array.from(new TextEncoder().encode(String(text)));
  },
  versionFor(length) {
    for (let version = 1; version <= 12; version++) {
      const countBits = version <= 9 ? 8 : 16;
      const capacity = QR.dataCodewords(version) * 8;
      const bits = 4 + countBits + length * 8;
      if (bits <= capacity) return version;
    }
    return 0;
  },
  dataCodewords(version) {
    const row = QR.blocks[version];
    return row[1] * row[2] + row[3] * row[4];
  },
  dataBytes(text, version) {
    const raw = QR.bytes(text);
    const countBits = version <= 9 ? 8 : 16;
    let bits = "0100" + raw.length.toString(2).padStart(countBits, "0");
    raw.forEach((byte) => { bits += byte.toString(2).padStart(8, "0"); });
    const capacity = QR.dataCodewords(version) * 8;
    bits += "0".repeat(Math.min(4, Math.max(0, capacity - bits.length)));
    if (bits.length % 8) bits += "0".repeat(8 - (bits.length % 8));
    const pads = ["11101100", "00010001"];
    let pad = 0;
    while (bits.length < capacity) {
      bits += pads[pad % 2];
      pad += 1;
    }
    const out = [];
    for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
    return out;
  },
  interleave(data, version) {
    const row = QR.blocks[version];
    const eccLen = row[0];
    const blocks = [];
    let offset = 0;
    [[row[1], row[2]], [row[3], row[4]]].forEach(([count, size]) => {
      for (let i = 0; i < count; i++) {
        const chunk = data.slice(offset, offset + size);
        offset += size;
        blocks.push({ data: chunk, ecc: QR.reedSolomon(chunk, eccLen) });
      }
    });
    const stream = [];
    const maxData = Math.max(row[2], row[4] || 0);
    for (let i = 0; i < maxData; i++) blocks.forEach((block) => { if (i < block.data.length) stream.push(block.data[i]); });
    for (let i = 0; i < eccLen; i++) blocks.forEach((block) => stream.push(block.ecc[i]));
    let bits = stream.map((byte) => byte.toString(2).padStart(8, "0")).join("");
    bits += "0".repeat(QR.remainder[version] || 0);
    return bits;
  },
  size(version) {
    return 21 + (version - 1) * 4;
  },
  blank(n) {
    return Array.from({ length: n }, () => Array(n).fill(0));
  },
  mark(matrix, reserved, row, col, dark) {
    matrix[row][col] = dark ? 1 : 0;
    reserved[row][col] = 1;
  },
  finder(matrix, reserved, row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const y = row + r;
        const x = col + c;
        if (y < 0 || x < 0 || y >= matrix.length || x >= matrix.length) continue;
        const edge = r < 0 || c < 0 || r > 6 || c > 6;
        const ring = r === 0 || c === 0 || r === 6 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        QR.mark(matrix, reserved, y, x, !edge && (ring || core));
      }
    }
  },
  alignment(matrix, reserved, row, col) {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        QR.mark(matrix, reserved, row + r, col + c, dark);
      }
    }
  },
  functions(version) {
    const n = QR.size(version);
    const matrix = QR.blank(n);
    const reserved = QR.blank(n);
    QR.finder(matrix, reserved, 0, 0);
    QR.finder(matrix, reserved, 0, n - 7);
    QR.finder(matrix, reserved, n - 7, 0);
    for (let i = 0; i < n; i++) {
      if (!reserved[6][i]) QR.mark(matrix, reserved, 6, i, i % 2 === 0);
      if (!reserved[i][6]) QR.mark(matrix, reserved, i, 6, i % 2 === 0);
    }
    const spots = QR.align[version] || [];
    spots.forEach((row) => spots.forEach((col) => {
      if (QR.hitsFinder(n, row, col)) return;
      QR.alignment(matrix, reserved, row, col);
    }));
    QR.mark(matrix, reserved, 4 * version + 9, 8, true);
    const formatAt = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ];
    formatAt.forEach(([row, col]) => { reserved[row][col] = 1; });
    for (let i = 0; i < 8; i++) {
      reserved[8][n - 1 - i] = 1;
      reserved[n - 1 - i][8] = 1;
    }
    if (version >= 7) {
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 3; j++) {
          reserved[i][n - 11 + j] = 1;
          reserved[n - 11 + j][i] = 1;
        }
      }
    }
    return { matrix, reserved };
  },
  masked(row, col, bit, mask) {
    const flip = [
      (row + col) % 2 === 0,
      row % 2 === 0,
      col % 3 === 0,
      (row + col) % 3 === 0,
      (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
      ((row * col) % 2) + ((row * col) % 3) === 0,
      (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
      (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
    ][mask];
    const dark = bit === "1";
    return flip ? !dark : dark;
  },
  place(base, reserved, bits, mask) {
    const n = base.length;
    const matrix = base.map((row) => row.slice());
    const taken = reserved.map((row) => row.slice());
    let index = 0;
    let upward = true;
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;
      for (let i = 0; i < n; i++) {
        const row = upward ? n - 1 - i : i;
        for (let shift = 0; shift < 2; shift++) {
          const x = col - shift;
          if (taken[row][x]) continue;
          const bit = index < bits.length ? bits[index] : "0";
          matrix[row][x] = QR.masked(row, x, bit, mask) ? 1 : 0;
          index += 1;
        }
      }
      upward = !upward;
    }
    return matrix;
  },
  hitsFinder(n, row, col) {
    const boxes = [[0, 0], [0, n - 7], [n - 7, 0]];
    for (let r = row - 2; r <= row + 2; r++) {
      for (let c = col - 2; c <= col + 2; c++) {
        if (boxes.some(([top, left]) => r >= top && r < top + 7 && c >= left && c < left + 7)) return true;
      }
    }
    return false;
  },
  writeFormat(matrix, mask) {
    const n = matrix.length;
    const bits = QR.formatM[mask];
    const bit = (index) => bits[index] === "1" ? 1 : 0;
    [0, 1, 2, 3, 4, 5, 7, 8].forEach((col, index) => { matrix[8][col] = bit(index); });
    [7, 5, 4, 3, 2, 1, 0].forEach((row, index) => { matrix[row][8] = bit(8 + index); });
    for (let i = 0; i < 7; i++) matrix[n - 1 - i][8] = bit(i);
    for (let i = 0; i < 8; i++) matrix[8][n - 8 + i] = bit(7 + i);
  },
  writeVersion(matrix, version) {
    if (version < 7) return;
    const bits = QR.versionBits[version];
    const n = matrix.length;
    for (let i = 0; i < 18; i++) {
      const dark = bits[17 - i] === "1" ? 1 : 0;
      const row = Math.floor(i / 3);
      const col = i % 3;
      matrix[row][n - 11 + col] = dark;
      matrix[n - 11 + col][row] = dark;
    }
  },
  penalty(matrix) {
    const n = matrix.length;
    let score = 0;
    const run = (get) => {
      for (let a = 0; a < n; a++) {
        let count = 1;
        for (let b = 1; b < n; b++) {
          if (get(a, b) === get(a, b - 1)) count += 1;
          else {
            if (count >= 5) score += 3 + count - 5;
            count = 1;
          }
        }
        if (count >= 5) score += 3 + count - 5;
      }
    };
    run((row, col) => matrix[row][col]);
    run((col, row) => matrix[row][col]);
    for (let row = 0; row < n - 1; row++) {
      for (let col = 0; col < n - 1; col++) {
        const bit = matrix[row][col];
        if (bit === matrix[row][col + 1] && bit === matrix[row + 1][col] && bit === matrix[row + 1][col + 1]) score += 3;
      }
    }
    const finder = (line) => {
      const text = line.join("");
      const marks = ["10111010000", "00001011101"];
      marks.forEach((mark) => {
        let from = 0;
        while (from >= 0) {
          from = text.indexOf(mark, from);
          if (from >= 0) {
            score += 40;
            from += 1;
          }
        }
      });
    };
    for (let row = 0; row < n; row++) finder(matrix[row]);
    for (let col = 0; col < n; col++) finder(matrix.map((row) => row[col]));
    let dark = 0;
    matrix.forEach((row) => row.forEach((bit) => { dark += bit; }));
    score += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;
    return score;
  },
  matrix(text, fixedMask) {
    const raw = QR.bytes(text);
    const version = QR.versionFor(raw.length);
    if (!version) throw new Error("链接太长，二维码放不下");
    const bits = QR.interleave(QR.dataBytes(text, version), version);
    const base = QR.functions(version);
    let best = null;
    let bestScore = Infinity;
    const masks = fixedMask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [fixedMask];
    masks.forEach((mask) => {
      const matrix = QR.place(base.matrix, base.reserved, bits, mask);
      QR.writeFormat(matrix, mask);
      QR.writeVersion(matrix, version);
      const score = QR.penalty(matrix);
      if (score < bestScore) {
        best = matrix;
        bestScore = score;
      }
    });
    return best;
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = QR;
