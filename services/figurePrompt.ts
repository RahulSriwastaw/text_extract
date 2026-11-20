export const SVG_FIGURE_INSTRUCTION = `For each image element, include a "svg" field alongside its caption and normalized bbox.
When the figure can be faithfully reproduced, put a complete static SVG string with a viewBox and xmlns="http://www.w3.org/2000/svg" in that field. Preserve the visible geometry, labels, units, values, colors, arrows and connections. Use g, line, rect, circle, ellipse, polyline, polygon, path, text and tspan with simple presentation attributes. Draw arrowheads with paths or polygons. Use single quotes for SVG attributes inside the JSON string. Do not use stylesheets, scripts, embedded images, links, references, or external resources.
For qualifying content figures with photographs, unreadable labels, or figures you cannot faithfully reproduce, return "svg": null. For those content figures, keep the image element, its caption and its location so the user can crop it manually. Never guess missing details. Keep tables as markdown tables.`;

export const CONTENT_FIGURE_INSTRUCTION = `Only return a figure when it conveys information in a question, option, worked solution, passage, or the main document data. Examples include a geometry drawing, a graph, or a photograph that the reader must interpret.
Ignore background watermarks, publisher or coaching logos, instructor portraits in banners, decorative cartoons, and header/footer branding. Omit their image elements entirely in crop and SVG modes. A page containing only text and branding has zero image elements.
When branding overlaps a real figure, select the actual figure and its labels as tightly as possible. Never select the watermark separately. Keep a logo or photograph only when the question or main text actually uses it as subject matter. For each retained image include "figureRole": "content".`;
export function mcqFigureInstruction(mode: 'off' | 'crop' | 'svg') {
  if (mode === 'off') return '';
  return '\n' + CONTENT_FIGURE_INSTRUCTION + '\nFor MCQs, place qualifying visuals in an extra "figures" array on the owning question. Each entry has "target" (question, option1 through option5, or solution), "sourcePage" (actual attached page number), "content" (short caption), and "bbox" [ymin,xmin,ymax,xmax] in 0–1000 page coordinates. Return [] for no figures. Keep image markup out of question and option text.\n' +
    (mode === 'svg' ? SVG_FIGURE_INSTRUCTION : '');
}
