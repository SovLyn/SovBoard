import type { ClipEntry } from "../App";

/** 根据 tag 标签名返回对应的 antd Tag 颜色 */
export function tagColor(label: string): string {
  if (label.startsWith("文本")) return "blue";
  if (label.startsWith("HTML")) return "orange";
  if (label.startsWith("图片")) return "purple";
  if (label.startsWith("文件")) return "cyan";
  if (label.startsWith("RTF")) return "red";
  return "default";
}

/** 提取条目的预览文本、图标和类型标签 */
export function getQuickPreview(entry: ClipEntry): {
  text: string;
  icon: string;
  tags: string[];
} {
  const tags: string[] = [];
  if (entry.text) tags.push("文本");
  if (entry.html) tags.push("HTML");
  if (entry.image) tags.push("图片");
  if (entry.files) tags.push(`文件 ×${entry.files.length}`);
  if (entry.rtf) tags.push("RTF");

  if (entry.text) {
    const singleLine = entry.text.replace(/\n/g, " ");
    const preview =
      singleLine.length > 40
        ? singleLine.substring(0, 40) + "…"
        : singleLine;
    return { text: preview, icon: entry.image ? "🖼️" : "📄", tags };
  }
  if (entry.html) {
    const stripped = entry.html.replace(/<[^>]*>/g, "").trim();
    const preview =
      stripped.length > 40
        ? stripped.substring(0, 40) + "…"
        : stripped || "(空HTML)";
    return { text: preview, icon: "🌐", tags };
  }
  if (entry.image) {
    return {
      text: `图片 ${entry.image.width}×${entry.image.height}`,
      icon: "🖼️",
      tags,
    };
  }
  if (entry.files) {
    const preview =
      entry.files.length === 1
        ? entry.files[0]
        : `${entry.files.length} 个文件`;
    return { text: preview, icon: "📁", tags };
  }
  if (entry.rtf) {
    const preview =
      entry.rtf.length > 40
        ? entry.rtf.substring(0, 40) + "…"
        : entry.rtf;
    return { text: preview, icon: "📄", tags };
  }
  return { text: "(空)", icon: "📄", tags };
}
