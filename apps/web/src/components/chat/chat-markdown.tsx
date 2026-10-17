import { Fragment, type ReactNode } from "react";

// The small Markdown subset the companion prompt allows: "### " headings, "- " / "* " / "1. "
// bullets, **bold**, and [L12] citations. Anything else stays plain text. React escapes it all,
// so model output can't inject markup.
const INLINE = /(\*\*[^*]+\*\*|\[L\d+\])/g;

type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; text: string };

/** Renders a reply. `cite(id)` returns the chip for an entry id, or null to drop the token
 *  (an id the API didn't confirm, or any id while the reply is still streaming). */
export function ChatMarkdown({
  text,
  cite,
}: {
  text: string;
  cite: (logId: number) => ReactNode | null;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {blocks(text).map((block, index) => {
        if (block.kind === "heading") {
          return (
            <h3
              key={index}
              className="m-0 pt-1 font-display text-[16px] leading-[1.45] font-bold text-teal-ink"
            >
              {inline(block.text, cite)}
            </h3>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List
              key={index}
              className={`m-0 flex flex-col gap-1.5 pl-5 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-navy`}
            >
              {block.items.map((item, i) => (
                <li key={i}>{inline(item, cite)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={index} className="m-0">
            {inline(block.text, cite)}
          </p>
        );
      })}
    </div>
  );
}

function blocks(text: string): Block[] {
  const out: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) {
      flush();
    } else if (heading) {
      flush();
      out.push({ kind: "heading", text: heading[1] });
    } else if (bullet || numbered) {
      flush();
      const ordered = !bullet;
      const item = (bullet ?? numbered)![1];
      const last = out.at(-1);
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else out.push({ kind: "list", ordered, items: [item] });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return out;
}

function inline(text: string, cite: (logId: number) => ReactNode | null): ReactNode {
  return text.split(INLINE).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    const citation = /^\[L(\d+)\]$/.exec(part);
    if (citation) return <Fragment key={index}>{cite(Number(citation[1]))}</Fragment>;
    return part;
  });
}
