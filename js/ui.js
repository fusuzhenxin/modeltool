const MODEL_BRANDS = {
  openai: { color: "#111111", paths: ["M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"] },
  anthropic: { color: "#d97757", paths: ["M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"] },
  deepseek: { color: "#4d6bfe", paths: ["M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45"] },
  gemini: { color: "#1a73e8", paths: ["M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"] },
  qwen: { color: "#615ef0", paths: ["M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06Zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z"] },
  grok: { color: "#111111", paths: ["M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"] },
  kimi: { color: "#111111", paths: ["M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z", "M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z"] },
  minimax: { color: "#111111", paths: ["M11.43 3.92a.86.86 0 1 0-1.718 0v14.236a1.999 1.999 0 0 1-3.997 0V9.022a.86.86 0 1 0-1.718 0v3.87a1.999 1.999 0 0 1-3.997 0V11.49a.57.57 0 0 1 1.139 0v1.404a.86.86 0 0 0 1.719 0V9.022a1.999 1.999 0 0 1 3.997 0v9.134a.86.86 0 0 0 1.719 0V3.92a1.998 1.998 0 1 1 3.996 0v11.788a.57.57 0 1 1-1.139 0zm10.572 3.105a2 2 0 0 0-1.999 1.997v7.63a.86.86 0 0 1-1.718 0V3.923a1.999 1.999 0 0 0-3.997 0v16.16a.86.86 0 0 1-1.719 0V18.08a.57.57 0 1 0-1.138 0v2a1.998 1.998 0 0 0 3.996 0V3.92a.86.86 0 0 1 1.719 0v12.73a1.999 1.999 0 0 0 3.996 0V9.023a.86.86 0 1 1 1.72 0v6.686a.57.57 0 0 0 1.138 0V9.022a2 2 0 0 0-1.998-1.997"] },
  doubao: { color: "#111111", paths: ["M5.31 15.756c.172-3.75 1.883-5.999 2.549-6.739-3.26 2.058-5.425 5.658-6.358 8.308v1.12C1.501 21.513 4.226 24 7.59 24a6.59 6.59 0 002.2-.375c.353-.12.7-.248 1.039-.378.913-.899 1.65-1.91 2.243-2.992-4.877 2.431-7.974.072-7.763-4.5l.002.001z", "M22.57 10.283c-1.212-.901-4.109-2.404-7.397-2.8.295 3.792.093 8.766-2.1 12.773a12.782 12.782 0 01-2.244 2.992c3.764-1.448 6.746-3.457 8.596-5.219 2.82-2.683 3.353-5.178 3.361-6.66a2.737 2.737 0 00-.216-1.084v-.002zM14.303 1.867C12.955.7 11.248 0 9.39 0 7.532 0 5.883.677 4.545 1.807 2.791 3.29 1.627 5.557 1.5 8.125v9.201c.932-2.65 3.097-6.25 6.357-8.307.5-.318 1.025-.595 1.569-.829 1.883-.801 3.878-.932 5.746-.706-.222-2.83-.718-5.002-.87-5.617h.001z", "M17.305 4.961a199.47 199.47 0 01-1.08-1.094c-.202-.213-.398-.419-.586-.622l-1.333-1.378c.151.615.648 2.786.869 5.617 3.288.395 6.185 1.898 7.396 2.8-1.306-1.275-3.475-3.487-5.266-5.323z"], opacity: ["0.45", "1", "0.45"] },
  xiaomi: { color: "#ff6900", paths: ["M12 0C8.016 0 4.756.255 2.493 2.516.23 4.776 0 8.033 0 12.012c0 3.98.23 7.235 2.494 9.497C4.757 23.77 8.017 24 12 24c3.983 0 7.243-.23 9.506-2.491C23.77 19.247 24 15.99 24 12.012c0-3.984-.233-7.243-2.502-9.504C19.234.252 15.978 0 12 0zM4.906 7.405h5.624c1.47 0 3.007.068 3.764.827.746.746.827 2.233.83 3.676v4.54a.15.15 0 0 1-.152.147h-1.947a.15.15 0 0 1-.152-.148V11.83c-.002-.806-.048-1.634-.464-2.051-.358-.36-1.026-.441-1.72-.458H7.158a.15.15 0 0 0-.151.147v6.98a.15.15 0 0 1-.152.148H4.906a.15.15 0 0 1-.15-.148V7.554a.15.15 0 0 1 .15-.149zm12.131 0h1.949a.15.15 0 0 1 .15.15v8.892a.15.15 0 0 1-.15.148h-1.949a.15.15 0 0 1-.151-.148V7.554a.15.15 0 0 1 .151-.149zM8.92 10.948h2.046c.083 0 .15.066.15.147v5.352a.15.15 0 0 1-.15.148H8.92a.15.15 0 0 1-.152-.148v-5.352a.15.15 0 0 1 .152-.147Z"] },
  meta: { color: "#0668e1", paths: ["M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"] },
  mistral: { color: "#f54e00", paths: ["M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z"] },
  bytedance: { color: "#111111", paths: ["M19.8772 1.4685L24 2.5326v18.9426l-4.1228 1.0563V1.4685zm-13.3481 9.428l4.115 1.0641v8.9786l-4.115 1.0642v-11.107zM0 2.572l4.115 1.0642v16.7354L0 21.428V2.572zm17.4553 5.6205v11.107l-4.1228-1.0642V9.2568l4.1228-1.0642z"] },
  zhipu: { color: "#3857d8", paths: ["M9.917 2c4.906 0 10.178 3.947 8.93 10.58-.014.07-.037.14-.057.21l-.003-.277c-.083-3-1.534-8.934-8.87-8.934-3.393 0-8.137 3.054-7.93 8.158-.04 4.778 3.555 8.4 7.95 8.332l.073-.001c1.2-.033 2.763-.429 3.1-1.657.063-.031.26.534.268.598.048.256.112.369.192.34.981-.348 2.286-1.222 1.952-2.38-.176-.61-1.775-.147-1.921-.347.418-.979 2.234-.926 3.153-.716.443.102.657.38 1.012.442.29.052.981-.2.96.242C17.226 19.632 13.833 22 9.918 22 3.654 22 0 16.574 0 11.737 0 5.947 4.959 2 9.917 2zM9.9 5.3c.484 0 1.125.225 1.38.585 3.669.145 4.313 2.686 4.694 5.444.255 1.838.315 2.3.182 1.387l.083.59c.068.448.554.737.982.516.144-.075.254-.231.328-.47a.2.2 0 01.258-.13l.625.22a.2.2 0 01.124.238 2.172 2.172 0 01-.51.92c-.878.917-2.757.664-3.08-.62-.14-.554-.055-.626-.345-1.242-.292-.621-1.238-.709-1.69-.295-.345.315-.407.805-.406 1.282L12.6 15.9a.9.9 0 01-.9.9h-1.4a.9.9 0 01-.9-.9v-.65a1.15 1.15 0 10-2.3 0v.65a.9.9 0 01-.9.9H4.8a.9.9 0 01-.9-.9l.035-3.239c.012-1.884.356-3.658 2.47-4.134.2-.045.252.13.29.342.025.154.043.252.053.294.701 3.058 1.75 4.299 3.144 3.722l.66-.331.254-.13c.158-.082.25-.131.276-.15.012-.01-.165-.206-.407-.464l-1.012-1.067a8.925 8.925 0 01-.199-.216c-.047-.034-.116.068-.208.306-.074.157-.251.252-.272.326-.013.058.108.298.362.72.164.288.22.508-.31.343-1.04-.8-1.518-2.273-1.684-3.725-.004-.035-.162-1.913-.162-1.913a1.2 1.2 0 011.113-1.281L9.9 5.3zm12.994 8.68c.037.697-.403.704-1.213.591l-1.783-.276c-.265-.053-.385-.099-.313-.147.47-.315 3.268-.93 3.31-.168zm-.915-.083l-.926.042c-.85.077-1.452.24.338.336l.103.003c.815.012 1.264-.359.485-.381zm1.667-3.601h.01c.79.398.067 1.03-.65 1.393-.14.07-.491.176-1.052.315-.241.04-.457.092-.333.16l.01.005c1.952.958-3.123 1.534-2.495 1.285l.38-.148c.68-.266 1.614-.682 1.666-1.337.038-.48 1.253-.442 1.493-.968.048-.106 0-.236-.144-.389-.05-.047-.094-.094-.107-.148-.073-.305.7-.431 1.222-.168zm-2.568-.474c-.135 1.198-2.479 4.192-1.949 2.863l.017-.042c.298-.717.376-2.221 1.337-3.221.25-.26.636.035.595.4zm-7.976-.253c.02-.694 1.002-.968 1.346-.347.01-1.274-1.941-.768-1.346.347z"] }
};

function modelBrand(id) {
  const key = String(id || "").toLowerCase();
  if (key.startsWith("gpt-") || key === "o3" || key.startsWith("o4")) return "openai";
  if (key.startsWith("claude")) return "anthropic";
  if (key.startsWith("deepseek")) return "deepseek";
  if (key.startsWith("kimi") || key.startsWith("moonshot")) return "kimi";
  if (key.startsWith("qwen")) return "qwen";
  if (key.startsWith("gemini")) return "gemini";
  if (key.startsWith("glm")) return "zhipu";
  if (key.startsWith("grok")) return "grok";
  if (key.startsWith("minimax")) return "minimax";
  if (key.startsWith("doubao")) return "doubao";
  if (key.startsWith("mimo")) return "xiaomi";
  if (key.startsWith("llama")) return "meta";
  if (key.startsWith("mistral")) return "mistral";
  return "";
}

const UI = {
  esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  },
  icon(name) {
    const paths = {
      shield: '<path fill="currentColor" stroke="none" d="M12 2.4 19.2 5.2v6c0 4.7-3.1 7.9-7.2 9.6-4.1-1.7-7.2-4.9-7.2-9.6V5.2L12 2.4zm-1 10.1 3.3-3.3 1.3 1.3-4.6 4.6-2.5-2.5 1.3-1.3 1.2 1.2z"/>',
      doc: '<path fill="currentColor" stroke="none" d="M7 3h6.4L18 7.6V19.4A1.6 1.6 0 0 1 16.4 21H7.6A1.6 1.6 0 0 1 6 19.4V4.6A1.6 1.6 0 0 1 7.6 3H7z"/><path fill="#fff" stroke="none" d="M8.3 12h7.4v1.5H8.3zm0 3.1h5.1v1.5H8.3z"/>',
      candy: '<path fill="currentColor" stroke="none" d="M3.6 12 8 8.4v7.2zM20.4 12 16 8.4v7.2z"/><rect x="7.6" y="7.6" width="8.8" height="8.8" rx="4.4" fill="currentColor" stroke="none"/>',
      car: '<path fill="currentColor" fill-rule="evenodd" stroke="none" d="M4 15.6h16v2.1a1 1 0 0 1-1 1h-.2a1.7 1.7 0 0 1-3.3 0H8.5a1.7 1.7 0 0 1-3.3 0H5a1 1 0 0 1-1-1v-2.1zm2.3-.9 1.7-4.2c.2-.6.8-1 1.5-1h4.8c.7 0 1.3.4 1.5 1l1.9 4.2H6.3zm2.1-3.1h2.3V13H8.4v-1.4zm4.4 0H15V13h-2.2v-1.4z"/>',
      clock: '<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none"/><path stroke="#fff" stroke-width="1.8" d="M12 8v4.4l2.6 1.6"/>',
      bulb: '<path fill="currentColor" stroke="none" d="M9 16.2h6v1.4H9zm.8 2.3h4.4V20H9.8zM12 3.2a5.4 5.4 0 0 0-3.3 9.6c.5.5.9 1.1.9 1.8h4.8c0-.7.4-1.3.9-1.8A5.4 5.4 0 0 0 12 3.2z"/>',
      check: '<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none"/><path stroke="#fff" stroke-width="2" d="M8.4 12.2 10.8 14.6 15.7 9.6"/>',
      mark: '<path d="M5.8 12.4 10 16.4 18.2 7.6" stroke="currentColor" stroke-width="2.4" fill="none"/>',
      chat: '<path fill="currentColor" stroke="none" d="M5.4 5.2h12.2A2.2 2.2 0 0 1 19.8 7.4V14a2.2 2.2 0 0 1-2.2 2.2H9.4L5 19.4V7.4a2.2 2.2 0 0 1 2.2-2.2h-1.8z"/>',
      code: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
      list: '<path d="M9 7h10M9 12h10M9 17h10"/><path d="M5.5 7h.5M5.5 12h.5M5.5 17h.5"/>',
      play: '<path d="M8 6.5v11l10-5.5-10-5.5z" fill="currentColor" stroke="none"/>',
      refresh: '<path d="M20 12a8 8 0 1 1-2.2-5.5"/><path d="M20 4.5V9h-4.5"/>',
      user: '<circle cx="12" cy="9" r="3.1"/><path d="M6.2 18.5a6 6 0 0 1 11.6 0"/>',
      chevron: '<path d="m7 10 5 5 5-5"/>',
      back: '<path d="M15 6 9 12l6 6"/>',
      more: '<circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
      chart: '<path d="M5 19V5M5 19h14"/><path d="M9 15v-3M13 15V8M17 15v-5"/>',
      info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
      target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
      search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 3.5 3.5"/>',
      download: '<path d="M12 5v10"/><path d="m8 11 4 4 4-4"/><path d="M5 19h14"/>',
      trash: '<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M8 7l1 12h6l1-12"/>',
      logout: '<path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h6A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 10 18.5V17"/><path d="M4 12h10"/><path d="m11 9 3 3-3 3"/>',
      out: '<path d="M14 5h5v5"/><path d="M19 5 10 14"/><path d="M16 13.5V19H5V8h5.5"/>',
      close: '<path d="m7 7 10 10M17 7 7 17"/>',
      menu: '<path d="M5 7h14M5 12h14M5 17h14"/>'
    };
    return `<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
  },
  diffLabel(key) {
    return { easy: "简单", medium: "中等", hard: "困难" }[key] || "中等";
  },
  statusBadge(status) {
    const map = {
      done: ["ok", "已完成"],
      running: ["run", "进行中"],
      pending: ["idle", "未开始"],
      stopped: ["stop", "已终止"]
    };
    const pair = map[status] || map.pending;
    return `<span class="badge ${pair[0]}"><i></i>${pair[1]}</span>`;
  },
  levelBadge(score, scene) {
    const info = Engine.judgeText(score, scene);
    if (info.level === "none") return `<span class="badge idle"><i></i>未检测</span>`;
    const cls = info.level === "ok" ? "ok" : info.level === "warn" ? "warn" : "bad";
    return `<span class="badge ${cls}"><i></i>${UI.esc(info.label)}</span>`;
  },
  modelMark(model) {
    const brand = MODEL_BRANDS[modelBrand(model && model.id)];
    if (!brand) return `<span class="m-dot" style="background:${model.color}">${UI.esc(model.short)}</span>`;
    const paths = brand.paths.map((d, index) => `<path fill="currentColor" d="${d}"${brand.opacity && brand.opacity[index] ? ` fill-opacity="${brand.opacity[index]}"` : ""}/>`).join("");
    return `<span class="m-dot brand" style="color:${brand.color}"><svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg></span>`;
  },
  modelChip(id, name) {
    const model = DATA.model(id);
    const label = name || model.name;
    return `<span class="model-chip">${UI.modelMark(model)}${UI.esc(label)}</span>`;
  },
  ring(score, color) {
    const missing = score == null || Number.isNaN(Number(score));
    const shown = missing ? "—" : score;
    const ratio = missing ? 0 : Math.max(0, Math.min(100, Number(score))) / 100;
    const r = 46;
    const c = 2 * Math.PI * r;
    const dash = c * ratio;
    const judged = Engine.judge(missing ? null : Number(score));
    const tone = color || (judged === "bad" ? "#ef5d5d" : judged === "warn" ? "#f0a03a" : judged === "ok" ? "#22c58b" : "#d5deec");
    const arc = ratio > 0
      ? `<circle cx="60" cy="60" r="${r}" stroke="${tone}" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="${dash} ${c - dash}"></circle>`
      : "";
    return `<div class="ring" aria-label="得分 ${shown}">
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="${r}" stroke="#e7eef8" stroke-width="10" fill="none"></circle>
        ${arc}
      </svg>
      <div class="num">${shown}<small>/100</small></div>
    </div>`;
  },
  shell(active, body) {
    const nav = [
      ["home", "index.html", "首页"],
      ["detect", "detect.html", "模型检测页"],
      ["basic", "basic.html", "基础测试页"],
      ["candy", "candy.html", "糖果测试页"],
      ["pelican", "pelican.html", "鹈鹕骑车测试页"],
      ["works", "works.html", "HTML鹈鹕作品"],
      ["prompts", "prompts.html", "提示词库"]
    ].map(([id, href, label]) => `<a href="${href}" class="${active === id ? "active" : ""}">${label}</a>`).join("");
    const cfg = Store.api();
    let apiLabel = "接口设置";
    if (cfg.baseUrl && cfg.apiKey) {
      try { apiLabel = new URL(cfg.baseUrl).host; } catch (err) { apiLabel = "已配置接口"; }
    }
    const marks = `<div class="marks">
      <button class="mark-btn" type="button" data-action="show-qq" aria-label="QQ群" title="QQ群">
        <svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673"/></svg>
      </button>
      <a class="mark-btn" href="https://github.com/fusuzhenxin/modeltool" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub">
        <svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
      </a>
    </div>`;
    const relay = `<a class="api-btn relay-nav" href="https://www.veridrop.cn" target="_blank" rel="noopener noreferrer" title="API中转导航">${UI.icon("out")}<span>中转导航</span></a>`;
    const account = `${marks}${relay}<button class="api-btn" type="button" data-action="open-api" title="${UI.esc(apiLabel)}">${UI.icon("info")}<span>${UI.esc(apiLabel)}</span></button>`;
    return `<header class="topbar">
      <div class="container topbar-inner">
        <a class="brand" href="index.html"><img class="logo" src="assets/favicon-32.png" width="32" height="32" alt=""><span>大模型降智检测</span></a>
        <nav class="nav" id="nav">${nav}</nav>
        <div class="account">${account}<button class="nav-toggle" type="button" data-action="nav" aria-label="打开菜单">${UI.icon("menu")}</button></div>
      </div>
    </header>
    <main class="page"><div class="container">${body}</div></main>`;
  },
  currentFile() {
    const file = (location.pathname.split("/").pop() || "index.html") + location.search;
    return file || "index.html";
  },
  safeNext(raw) {
    if (!raw) return "index.html";
    let text = raw;
    try { text = decodeURIComponent(raw); } catch (err) { return "index.html"; }
    if (text.startsWith("/") || text.includes("\\") || text.includes("://") || text.includes("..")) return "index.html";
    if (!/^[a-z0-9_.\-]+\.html([?#].*)?$/i.test(text)) return "index.html";
    return text;
  },
  select(id, value, options) {
    const current = options.find((item) => item.value === value) || options[0];
    const menu = options.map((item) => `<button type="button" data-action="pick" data-select="${UI.esc(id)}" data-value="${UI.esc(item.value)}" class="${item.value === current.value ? "active" : ""}">${item.icon || ""}${UI.esc(item.label)}</button>`).join("");
    return `<div class="select" data-select-wrap="${UI.esc(id)}">
      <button type="button" class="select-btn" data-action="toggle-select" data-select="${UI.esc(id)}">
        <span class="select-label">${current.icon || ""}${UI.esc(current.label)}</span>
        ${UI.icon("chevron")}
      </button>
      <div class="select-menu"><input class="select-filter" placeholder="搜索模型或 ID" aria-label="搜索模型">${menu}</div>
    </div>`;
  },
  field(label, control) {
    return `<div class="field"><span>${label}</span>${control}</div>`;
  },
  siteIsLocal() {
    const host = (location.hostname || "").toLowerCase();
    return location.protocol === "file:" || host === "127.0.0.1" || host === "localhost";
  },
  forwardNote() {
    if (UI.siteIsLocal()) return "请求由你电脑上的 start.bat 转发到填写的接口。";
    return "请求由当前网站转发到填写的接口。";
  },
  offlineForward() {
    if (UI.siteIsLocal()) return "连不上本机转发。请先双击项目里的 start.bat，再用 http://127.0.0.1:8766/index.html 打开，不要直接双击 html。";
    return "连不上网站转发。请稍后再试。";
  },
  platformStop(status, text) {
    const raw = String(text || "");
    const stopped = Number(status) === 504 || raw.indexOf("FUNCTION_INVOCATION_TIMEOUT") >= 0;
    if (!stopped || UI.siteIsLocal()) return "";
    return "这次请求超过了线上转发的 300 秒，被平台停掉了。这不是上游超时。需要一直等到上游返回时，用本机 start.bat 打开 http://127.0.0.1:8766 。";
  },
  toast(message) {
    document.querySelectorAll(".toast").forEach((node) => node.remove());
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  },
  modal({ title, body, okText, cancelText, onOk }) {
    const mask = document.createElement("div");
    mask.className = "modal-mask";
    mask.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>${UI.esc(title)}</h3>
      <p>${body}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-modal="cancel">${UI.esc(cancelText || "取消")}</button>
        <button type="button" class="btn btn-primary btn-sm" data-modal="ok">${UI.esc(okText || "确定")}</button>
      </div>
    </div>`;
    mask.addEventListener("click", (event) => {
      if (event.target === mask || event.target.closest("[data-modal='cancel']")) mask.remove();
      if (event.target.closest("[data-modal='ok']")) {
        mask.remove();
        onOk?.();
      }
    });
    document.body.appendChild(mask);
  },
  closeFloaters() {
    document.querySelectorAll(".select.open").forEach((node) => node.classList.remove("open"));
    document.querySelectorAll(".menu-pop").forEach((node) => node.remove());
  },
  download(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  },
  bind() {
    if (UI.bound) return;
    UI.bound = true;
    document.addEventListener("click", (event) => {
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) {
        if (!event.target.closest(".select") && !event.target.closest(".menu-pop")) UI.closeFloaters();
        return;
      }
      const action = actionEl.dataset.action;
      if (action !== "toggle-select" && action !== "pick" && action !== "more" && action !== "user-menu") UI.closeFloaters();
      if (Actions[action]) Actions[action](actionEl, event);
    });
    document.addEventListener("input", (event) => {
      const input = event.target.closest(".select-filter");
      if (!input) return;
      const query = input.value.trim().toLowerCase();
      input.parentElement.querySelectorAll("button").forEach((button) => {
        const text = (button.textContent + " " + (button.dataset.value || "")).toLowerCase();
        button.hidden = Boolean(query) && !text.includes(query);
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        UI.closeFloaters();
        document.querySelector(".modal-mask")?.remove();
      }
    });
  }
};

const Form = {
  values: {},
  set(id, value) { Form.values[id] = value; },
  get(id, fallback) { return Form.values[id] ?? fallback; }
};
