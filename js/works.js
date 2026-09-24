/* 公开作品。本站文件和外部网址都在这里，所有人看到的是同一批。 */
const LOCAL_WORKS = [
  ["glm-5.2", "GLM-5.2"],
  ["qwen3.6", "Qwen3.6-27B"],
  ["kimi-k3", "Kimi-K3"],
  ["gpt-5.6-sol", "GPT-5.6 Sol"],
  ["claude-opus-5", "Claude Opus 5"]
].map(([id, model]) => ({
  id,
  title: model + " 的鹈鹕骑车",
  description: model + " 按 “Generate an SVG of a pelican riding a bicycle” 画出的静态 SVG，包在 HTML 里。来自 Apache-2.0 数据集 pelican-svg-drawings。",
  category: "静态 SVG",
  tags: ["静态 SVG", "开源", model],
  source: "pelican-svg-drawings",
  sourceUrl: "https://huggingface.co/datasets/sergiopaniego/pelican-svg-drawings",
  license: "Apache-2.0",
  file: "works/" + id + ".html"
})).concat([
  {
    id: "qwen3.6-2d",
    title: "Qwen3.6-27B 的 2D 动画",
    description: "同一只开源鹈鹕，只给两个车轮加了旋转。画面可以在线看，也可以下载 HTML。",
    category: "2D 动画",
    tags: ["2D 动画", "开源", "Qwen3.6-27B"],
    source: "pelican-svg-drawings",
    sourceUrl: "https://huggingface.co/datasets/sergiopaniego/pelican-svg-drawings",
    license: "Apache-2.0",
    file: "works/qwen3.6-2d.html"
  },
  {
    id: "tihuqiche",
    title: "鹈鹕骑车 3D",
    description: "憧憬Licoy 的 3D 游戏《鹈鹕骑车》。Three.js 单文件 HTML，含鹈鹕、自行车和海岛赛道，MIT 许可。在线版在 tihuqiche.com。",
    category: "3D",
    tags: ["3D", "开源", "Three.js"],
    source: "鹈鹕骑车 · Pelican Pedal Run",
    sourceUrl: "https://github.com/Licoy/tihuqiche",
    license: "MIT",
    file: "works/tihuqiche.html",
    heavy: true
  }
]);
const WORKS = [
  {
    id: "qq-speed",
    title: "QQ飞车",
    description: "Claude Opus 5.5 一句话做出的网页竞速：漂移、氮气和四条赛道，模型和音效都由代码生成。这是公开同人演示，不是腾讯官方游戏。",
    category: "3D",
    tags: ["3D", "Claude Opus 5.5", "竞速"],
    source: "riba2534 / claude-opus-5-5-demo",
    sourceUrl: "https://github.com/riba2534/claude-opus-5-5-demo",
    url: "https://lf3-static.bytednsdoc.com/obj/eden-cn/nulojnulwlo/qqfeiche3d/index.html"
  },
  {
    id: "cf-ship",
    title: "穿越火线之运输船",
    description: "Claude Opus 5.5 做的运输船网页射击：甲板、集装箱、枪械和电脑对手。公开同人演示，不是腾讯官方游戏。",
    category: "3D",
    tags: ["3D", "Claude Opus 5.5", "射击"],
    source: "riba2534 / claude-opus-5-5-demo",
    sourceUrl: "https://github.com/riba2534/claude-opus-5-5-demo",
    url: "https://lf3-static.bytednsdoc.com/obj/eden-cn/nulojnulwlo/cf-transport-ship/transport-ship.html"
  },
  {
    id: "pelican-bike-opus",
    title: "鹈鹕骑自行车",
    description: "Claude Opus 5.5 做的海岸骑行：头盔、红围巾、海浪、昼夜和抓鱼。没有外部贴图，页面本身就是作品。",
    category: "3D",
    tags: ["3D", "Claude Opus 5.5", "鹈鹕骑车"],
    source: "riba2534 / claude-opus-5-5-demo",
    sourceUrl: "https://github.com/riba2534/claude-opus-5-5-demo",
    url: "https://lf3-static.bytednsdoc.com/obj/eden-cn/nulojnulwlo/pelican-bike/index.html"
  },
  {
    id: "red-cliffs",
    title: "赤壁之战 208",
    description: "Claude Fable 5 一次对话写出的单文件 Three.js。九幕时间轴重现赤壁战场，公开页面可直接看。",
    category: "3D",
    tags: ["3D", "Claude Fable 5"],
    source: "yazelin / red-cliffs-3d",
    sourceUrl: "https://github.com/yazelin/red-cliffs-3d",
    url: "https://yazelin.github.io/red-cliffs-3d/"
  },
  {
    id: "storm-race",
    title: "STORM RACE",
    description: "GPT-6 Astra 做的浏览器竞速，作者发在 X 上。打开原页就能开。",
    category: "3D",
    tags: ["3D", "GPT-6 Astra", "竞速"],
    source: "@BubuStd",
    sourceUrl: "https://x.com/BubuStd/status/2096587056755638553",
    url: "https://storm-race.vercel.app/"
  },
  {
    id: "junk-run",
    title: "JUNK RUN",
    description: "GPT-6 Astra 的废土跑酷网页。这个站只允许在自己的域名里嵌页面，请用打开原页进入。",
    category: "3D",
    tags: ["3D", "GPT-6 Astra"],
    source: "@hermesailab",
    sourceUrl: "https://x.com/hermesailab/status/2097508053901840850",
    url: "https://junk-run.pages.dev/",
    embed: false
  },
  {
    id: "harbor-skirmish",
    title: "Harbor Skirmish",
    description: "GPT-6 Astra 用 Three.js 做的海战。公开试玩页，点开就是战场。",
    category: "3D",
    tags: ["3D", "GPT-6 Astra", "射击"],
    source: "@OpenDesignHQ",
    sourceUrl: "https://x.com/OpenDesignHQ/status/2097635757917983223",
    url: "https://gpt6astra-game.vercel.app/"
  },
  {
    id: "westward",
    title: "Westward",
    description: "俄勒冈小道的现代 3D 复刻，浏览器里走西进路线。来自 X 上的 GPT-6 Astra 演示。",
    category: "3D",
    tags: ["3D", "GPT-6 Astra"],
    source: "@bis_waz",
    sourceUrl: "https://x.com/bis_waz/status/2098023593468907747",
    url: "https://biswaz.me/westward/"
  },
  {
    id: "sulli-run",
    title: "Sulli RUN",
    description: "一张平面画做成的赛博朋克 3D 跑酷。GPT-6 Astra 搭的公开网页。",
    category: "3D",
    tags: ["3D", "GPT-6 Astra", "跑酷"],
    source: "@Mortezabihzadeh",
    sourceUrl: "https://x.com/Mortezabihzadeh/status/2102719520699830417",
    url: "https://sulli-game.vercel.app/"
  },
  {
    id: "magic-carpet",
    title: "Magic Carpet Wizard",
    description: "Three.js 飞毯。GitHub Pages 上的公开页面，打开就能飞。",
    category: "3D",
    tags: ["3D", "Three.js"],
    source: "threapchills",
    sourceUrl: "https://github.com/threapchills/MagicCarpetWizard",
    url: "https://threapchills.github.io/MagicCarpetWizard/"
  },
  {
    id: "shells-3d",
    title: "零点街区",
    description: "弹壳特攻队风格的 3D 网页小游戏。作者把可玩地址发在 X 上。",
    category: "3D",
    tags: ["3D", "射击"],
    source: "@sonic0828",
    sourceUrl: "https://x.com/sonic0828/status/2097601232877781344",
    url: "https://iamsonic.net/2026/mini-games/shells-3d/play.html"
  },
  {
    id: "top-tennis",
    title: "Top Tennis",
    description: "浏览器 3D 网球。作者在 X 上说用 Codex 和 GPT-6 Astra 搭了大约两天。",
    category: "3D",
    tags: ["3D", "GPT-6 Astra"],
    source: "@teovito",
    sourceUrl: "https://x.com/teovito/status/2102686586723033440",
    url: "https://toptennisgame.com/"
  },
  {
    id: "duck-off",
    title: "Duck Off",
    description: "多人橡皮鸭竞速。GPT-6 Astra 和 Fable 做的公开网站，打开就能划。",
    category: "3D",
    tags: ["3D", "GPT-6 Astra", "竞速"],
    source: "@swarnimodi",
    sourceUrl: "https://x.com/swarnimodi/status/2100196454367437275",
    url: "https://duckoff.fun/"
  },
  {
    id: "settlecoast",
    title: "Settlecoast",
    description: "Meng To 用 GPT-6 Astra 做的海岛经营。公开网站，手机和电脑都能开一局。",
    category: "3D",
    tags: ["3D", "GPT-6 Astra"],
    source: "@MengTo",
    sourceUrl: "https://x.com/MengTo/status/2099125215708234119",
    url: "https://settlecoast.com/"
  },
  {
    id: "last-light",
    title: "LAST LIGHT",
    description: "Northline 的网页故事关卡。GPT-6 Astra 演示，Pages 上直接打开。",
    category: "3D",
    tags: ["3D", "GPT-6 Astra"],
    source: "@md_taqui_imam",
    sourceUrl: "https://x.com/md_taqui_imam/status/2096255279650517081",
    url: "https://last-light-northline.pages.dev/"
  },
  {
    id: "wonderforge",
    title: "WonderForge",
    description: "文明风的奇迹建造动画。GPT-6 加 Three.js 的公开页面。",
    category: "3D",
    tags: ["3D", "GPT-6"],
    source: "@auracanvas",
    sourceUrl: "https://x.com/auracanvas/status/2101919244527260018",
    url: "https://wonderforge.pages.dev/"
  },
  {
    id: "red-flag",
    title: "RED FLAG",
    description: "日本一般道路的限速计时赛，单个 HTML。作者把文件地址发在 X 上。",
    category: "3D",
    tags: ["3D", "竞速"],
    source: "@seimusic",
    sourceUrl: "https://x.com/seimusic/status/2098045891781480757",
    url: "https://seimusic.info/file/red_flag_game.html"
  },
  {
    id: "starship-foundry",
    title: "Starship Foundry",
    description: "等距造船再飞出去的单个 HTML。Three.js 实验室，公开地址可直接开。",
    category: "3D",
    tags: ["3D", "Three.js"],
    source: "@Aaron_Wacker",
    sourceUrl: "https://x.com/Aaron_Wacker/status/2100382539697254828",
    url: "https://allaiinc.org/Starship-Foundry-Isometric-Flight-Lab.html"
  },
  {
    id: "pacman-sharks",
    title: "PAC-MAN: Ghost Sharks",
    description: "吃豆人风格的网页小游戏。公开地址在 Workers 上，打开就能玩。",
    category: "互动",
    tags: ["互动", "街机"],
    source: "@awildnpc",
    sourceUrl: "https://x.com/awildnpc/status/2096034211782099313",
    url: "https://pacman.demyx.workers.dev/"
  },
  {
    id: "pvz-web",
    title: "植物大战僵尸网页版",
    description: "公开的网页植物大战僵尸。GitHub Pages 上就能打，不是官方客户端。",
    category: "互动",
    tags: ["互动", "塔防"],
    source: "seth-xh / pvz",
    sourceUrl: "https://github.com/seth-xh/pvz",
    url: "https://seth-xh.github.io/pvz/"
  },
  {
    id: "hyperbrick",
    title: "HYPERBRICK",
    description: "Claude Opus 5.5 写的单文件打砖块。CSS 和脚本都在这一个 HTML 里。",
    category: "互动",
    tags: ["互动", "Claude Opus 5.5"],
    source: "MiaAI-Lab",
    sourceUrl: "https://github.com/MiaAI-Lab/Claude-Opus-5.5-100-HTML-Files",
    url: "https://miaai-lab.github.io/Claude-Opus-5.5-100-HTML-Files/038-neon-breakout.html"
  },
  {
    id: "chess-study",
    title: "Grandmaster's Study",
    description: "Claude Opus 5.5 写的单文件国际象棋练习页。",
    category: "互动",
    tags: ["互动", "Claude Opus 5.5"],
    source: "MiaAI-Lab",
    sourceUrl: "https://github.com/MiaAI-Lab/Claude-Opus-5.5-100-HTML-Files",
    url: "https://miaai-lab.github.io/Claude-Opus-5.5-100-HTML-Files/070-chess-study.html"
  },
  {
    id: "strandbeest",
    title: "Windwalker",
    description: "Claude Opus 5.5 写的风力步行机械模拟，单文件 HTML。",
    category: "互动",
    tags: ["互动", "Claude Opus 5.5"],
    source: "MiaAI-Lab",
    sourceUrl: "https://github.com/MiaAI-Lab/Claude-Opus-5.5-100-HTML-Files",
    url: "https://miaai-lab.github.io/Claude-Opus-5.5-100-HTML-Files/093-strandbeest-walker.html"
  },
  {
    id: "soft-machine",
    title: "Soft Machine",
    description: "Claude Opus 5.5 写的可弹合成器，声音在浏览器里现算。",
    category: "互动",
    tags: ["互动", "Claude Opus 5.5", "音乐"],
    source: "MiaAI-Lab",
    sourceUrl: "https://github.com/MiaAI-Lab/Claude-Opus-5.5-100-HTML-Files",
    url: "https://miaai-lab.github.io/Claude-Opus-5.5-100-HTML-Files/007-neumorphic-synth.html"
  },
  {
    id: "pocket-city",
    title: "Pocket Metropolis",
    description: "Claude Opus 5.5 写的等距小城，可以摆房子、看昼夜。",
    category: "互动",
    tags: ["互动", "Claude Opus 5.5"],
    source: "MiaAI-Lab",
    sourceUrl: "https://github.com/MiaAI-Lab/Claude-Opus-5.5-100-HTML-Files",
    url: "https://miaai-lab.github.io/Claude-Opus-5.5-100-HTML-Files/025-isometric-city.html"
  },
  {
    id: "luminote",
    title: "Luminote",
    description: "Claude Opus 5.5 写的下落音符钢琴，单文件就能弹。",
    category: "互动",
    tags: ["互动", "Claude Opus 5.5", "音乐"],
    source: "MiaAI-Lab",
    sourceUrl: "https://github.com/MiaAI-Lab/Claude-Opus-5.5-100-HTML-Files",
    url: "https://miaai-lab.github.io/Claude-Opus-5.5-100-HTML-Files/080-falling-notes-piano.html"
  },
  {
    id: "brandenburg-piano",
    title: "Brandenburg Piano",
    description: "巴赫勃兰登堡风格的网页钢琴。GPT-6 Astra 演示，作者发在 X 上。",
    category: "互动",
    tags: ["互动", "GPT-6 Astra", "音乐"],
    source: "@DeryaTR_",
    sourceUrl: "https://x.com/DeryaTR_/status/2096090915790069857",
    url: "https://brandenburg-piano.vercel.app/"
  },
  {
    id: "navier-stokes",
    title: "Inside the Blowup",
    description: "纳维-斯托克斯方程的互动讲解页。公开网站，当一本书翻。",
    category: "互动",
    tags: ["互动", "科普"],
    source: "@aurel_pr",
    sourceUrl: "https://x.com/aurel_pr/status/2097588775710818472",
    url: "https://explain-navier-stokes.netlify.app/"
  },
  {
    id: "timber-atlas",
    title: "木构图志",
    description: "中国古建木构的三维拆解。GPT-6 Astra 和 Codex 做的公开网站。",
    category: "3D",
    tags: ["3D", "GPT-6 Astra"],
    source: "@DuXiaodan",
    sourceUrl: "https://x.com/DuXiaodan/status/2099653288756932859",
    url: "https://timber-atlas.xiaodan.io/"
  },
  {
    id: "dust-front",
    title: "DUST FRONT",
    description: "浏览器即时战略。GPT-6 Astra 加 Blender 做的公开站。这个站不允许嵌进别的页面，用打开原页进入。",
    category: "3D",
    tags: ["3D", "GPT-6 Astra", "策略"],
    source: "@mustafaakin",
    sourceUrl: "https://x.com/mustafaakin/status/2097658461228069121",
    url: "https://dust-front.mustafaakin.dev/",
    embed: false
  },
  {
    id: "astra-globe",
    title: "3D 物流地球",
    description: "GPT-6 Astra 按一张图做出的 Three.js 地球仪表盘。站点禁止嵌入，用打开原页看。",
    category: "3D",
    tags: ["3D", "GPT-6 Astra"],
    source: "AI Kai",
    sourceUrl: "https://hqman.me/blog/gpt-6-astra-3d-globe-dashboard/",
    url: "https://hqman.me/demo/gpt-6-astra-3d-globe/",
    embed: false
  },
  {
    id: "pelican-zoo",
    title: "鹈鹕动物园",
    description: "把各家模型画的鹈鹕骑车收在一个站里，能点进去看原图。公开网站。",
    category: "互动",
    tags: ["互动", "鹈鹕骑车"],
    source: "pelicanzoo.ai",
    sourceUrl: "https://pelicanzoo.ai/",
    url: "https://pelicanzoo.ai/"
  },
  {
    id: "claude-100-html",
    title: "Claude Opus 5.5 的 100 个 HTML",
    description: "一百个单文件页面：生成艺术、乐器、游戏和版面。点进去是整份画廊，每件都能单独打开。",
    category: "互动",
    tags: ["互动", "Claude Opus 5.5"],
    source: "MiaAI-Lab",
    sourceUrl: "https://github.com/MiaAI-Lab/Claude-Opus-5.5-100-HTML-Files",
    url: "https://miaai-lab.github.io/Claude-Opus-5.5-100-HTML-Files/"
  },
  {
    id: "astra-100-html",
    title: "GPT-6 Astra 的 100 个 HTML",
    description: "GPT-6 Astra 写的一百个单文件视觉练习，画廊页面公开可翻。",
    category: "互动",
    tags: ["互动", "GPT-6 Astra"],
    source: "MiaAI-Lab",
    sourceUrl: "https://github.com/MiaAI-Lab/GPT-6-Astra-100-HTML-Files",
    url: "https://miaai-lab.github.io/GPT-6-Astra-100-HTML-Files/"
  },
  {
    id: "fable-100-html",
    title: "Claude Fable 5.1 的 100 个 HTML",
    description: "Fable 5.1 一次任务写出的一百个单文件页面。作者把画廊发在 X 上。",
    category: "互动",
    tags: ["互动", "Claude Fable 5.1"],
    source: "@MiaAI_lab",
    sourceUrl: "https://x.com/MiaAI_lab/status/2094894089481117731",
    url: "https://miaai-lab.github.io/Fable-5.1-100-HTML-Files/"
  }
].concat(LOCAL_WORKS);
