// 壁纸设计：平台定义 + 焦点裁剪 + Canvas 合成（静态图 + 调色 + 粒子）。
// 裁剪/焦点是纯函数，便于单测；Canvas 合成依赖 DOM，仅在浏览器运行时调用。

import { applyGrading, hasGrading } from './colorGrade.js';

// 四端导出分辨率。母版本身就是 4K（超分后约 3852×2148），所以四端必须按 4K 出，
// 否则等于把 4K 母版白超分了一遍再缩回 1080P —— 之前就是这个坑，成片只有 2~3MB。
// 规则：横屏三端长边 3840，竖屏手机按「宽 2160」出（9:20 → 2160×4800）。
// 长边一律取 3840 而不是母版尺寸，是为了让 x264 走整数缩放、避免奇数宽高。
// 代价与上限：iPhone/安卓竖屏是从 16:9 母版里竖切一条，光学上仍然软（2160 宽 ← 源约 966 宽），
// 这是母版长宽比决定的，只能靠超分模型给素材时补细节，导出端无法凭空造像素。
export const WALLPAPER_PLATFORMS = [
  { id: 'pc', label: 'PC / Mac', hint: '16:9', ratio: 16 / 9, exportWidth: 3840, exportHeight: 2160 },
  { id: 'phone', label: '手机', hint: '9:20', ratio: 9 / 20, exportWidth: 2160, exportHeight: 4800 },
  { id: 'tablet', label: '安卓平板', hint: '16:10', ratio: 16 / 10, exportWidth: 3840, exportHeight: 2400 },
  { id: 'ipad', label: 'iPad', hint: '4:3', ratio: 4 / 3, exportWidth: 3840, exportHeight: 2880 },
];

export const WALLPAPER_FOCUS_DEFAULT = { fx: 0.5, fy: 0.5 };

// 按比例 r 与焦点 (fx, fy)∈[0,1]² 计算源图内的裁剪窗口（object-fit: cover）。
export function cropForFocus(sw, sh, ratio, fx, fy) {
  let cw;
  let ch;
  if (sw / sh > ratio) {
    ch = sh;
    cw = sh * ratio;
  } else {
    cw = sw;
    ch = sw / ratio;
  }
  const maxX = Math.max(0, sw - cw);
  const maxY = Math.max(0, sh - ch);
  const cx = cw / 2 + maxX * fx;
  const cy = ch / 2 + maxY * fy;
  return { sx: cx - cw / 2, sy: cy - ch / 2, sw: cw, sh: ch };
}

// 把预览框内的一段拖拽位移换算成焦点增量（全局焦点，四端联动）。
export function focusDeltaFromDrag(dx, dy, canvasW, canvasH, crop, sw, sh) {
  const rangeX = Math.max(1, sw - crop.sw);
  const rangeY = Math.max(1, sh - crop.sh);
  const dfx = (dx * crop.sw) / canvasW / rangeX;
  const dfy = (dy * crop.sh) / canvasH / rangeY;
  return { dfx, dfy };
}

// 主编辑画布拖拽：画布显示的是「完整图片」（contain），
// 因此位移换算用的是完整图片在画布内的绘制尺寸，而非某个裁剪窗口。
export function focusDeltaFromEditorDrag(dx, dy, imgW, imgH, crop, sw, sh) {
  const rangeX = Math.max(1, sw - crop.sw);
  const rangeY = Math.max(1, sh - crop.sh);
  const dfx = (dx * sw) / Math.max(1, imgW) / rangeX;
  const dfy = (dy * sh) / Math.max(1, imgH) / rangeY;
  return { dfx, dfy };
}

// 裁剪窗口归一化：把「源图像素」的裁剪框换算成 0~1 的比例。
// 预览用 720P 母版、导出用 4K 母版，两者尺寸不同但画面一致，
// 用比例传递裁剪框才能保证「预览里框住的区域」就是「导出时裁下的区域」。
export function normalizeCrop(crop, sw, sh) {
  const w = Math.max(1, sw);
  const h = Math.max(1, sh);
  return {
    sx: crop.sx / w,
    sy: crop.sy / h,
    sw: crop.sw / w,
    sh: crop.sh / h,
  };
}

// 把归一化裁剪框还原到另一套源尺寸上。
export function scaleCrop(norm, sw, sh) {
  return {
    sx: norm.sx * sw,
    sy: norm.sy * sh,
    sw: norm.sw * sw,
    sh: norm.sh * sh,
  };
}

// 循环时长：有视频源时以视频自身为准（母版首尾同帧，长度就是它的循环周期）。
// 否则用粒子时长——两者不一致会让「视频循环」和「粒子循环」互相错拍，
// 合成出来的整段就不再无缝。
export function loopDurationFor(source, fallback) {
  const video = source && source.kind === 'video' ? source.el : null;
  const duration = video && Number.isFinite(video.duration) ? video.duration : 0;
  if (duration > 0.2) return duration;
  return fallback;
}

// 计算完整图片以 object-fit: contain 放进给定画布后的绘制矩形。
export function containRect(sw, sh, canvasW, canvasH) {
  const scale = Math.min(canvasW / sw, canvasH / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}

// 渲染一张「裁剪 + 调色」后的静态帧到离屏 Canvas，返回该 Canvas。
// applyGrading 返回的是 { data, width, height } 纯对象（便于 Node 单测），
// 而 canvas 的 putImageData 需要真正的 ImageData 实例。这里统一转换并写入。
export function putGradedImage(ctx, graded, dx, dy) {
  const out = ctx.createImageData(graded.width, graded.height);
  out.data.set(graded.data);
  ctx.putImageData(out, dx, dy);
}

export function renderGradedCanvas(img, crop, params, outW, outH) {
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, outW, outH);
  // 参数全 0 时直接交出「裁剪好的底图」：预览逐帧调用，省掉一次回读+回写。
  if (!hasGrading(params)) return canvas;
  const frame = ctx.getImageData(0, 0, outW, outH);
  const graded = applyGrading(frame, params);
  putGradedImage(ctx, graded, 0, 0);
  return canvas;
}

// 把「调色后的静态帧」绘制到目标画布（用于导出时逐帧合成）。
export function drawGradedFrame(ctx, img, crop, params, outW, outH, offscreen) {
  const graded = offscreen || renderGradedCanvas(img, crop, params, outW, outH);
  ctx.drawImage(graded, 0, 0, outW, outH);
  return graded;
}
