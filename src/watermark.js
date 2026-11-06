// 批量水印：Canvas 满屏斜向平铺半透明文字水印。
// 文字沿左下→右上方向（负角度）重复铺贴，整张图覆盖一层半透明水印。

export const DEFAULT_WATERMARK_TEXT = 'shixiaoyu-funny';
export const DEFAULT_WATERMARK_FONT_SIZE = 40;
export const DEFAULT_WATERMARK_LETTER_GAP = 40;  // 字间距：沿文字方向，字与字之间的空隙（px）
export const DEFAULT_WATERMARK_LINE_GAP = 120;   // 行间距：行与行之间，字号之外的空隙（px）

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });
}

// 给一张图（data URL）盖满屏斜向半透明水印，返回 PNG dataURL。
export async function watermarkDataUrl(dataUrl, text, opts = {}) {
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const {
    angle = -45,                             // 负角度 = 左下→右上
    alpha = 0.18,                            // 水印透明度 0~1
    fontSize = DEFAULT_WATERMARK_FONT_SIZE,  // 水印字号（px）
    letterGap = DEFAULT_WATERMARK_LETTER_GAP,// 字间距（px）
    lineGap = DEFAULT_WATERMARK_LINE_GAP,    // 行间距（px）
  } = opts;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = alpha;
  // 轻微暗描边，让白字在浅色图上也可读。
  ctx.lineWidth = Math.max(1, Math.round(fontSize / 18));
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';

  // 测量文字实际渲染宽度：沿文字方向的间距 = 文字宽度 + 字间距，保证文字永不粘连。
  const textWidth = ctx.measureText(text).width;
  const stepX = textWidth + Number(letterGap);
  // 行方向间距 = 字号 + 行间距，下限 1.3 倍字号，避免行与行也重叠。
  const stepY = Math.max(fontSize + Number(lineGap), fontSize * 1.3);

  const diagonal = Math.ceil(Math.hypot(width, height));
  for (let y = -diagonal; y <= diagonal; y += stepY) {
    for (let x = -diagonal; x <= diagonal; x += stepX) {
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();

  return canvas.toDataURL('image/png');
}
