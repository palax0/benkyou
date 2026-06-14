import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

// Dumb view: markdown when we have it, flat raw_content fallback for old items.
// {/* DESIGN-GAP: markdown prose tokens (heading/code/blockquote/list scale + rhythm)
//     not yet in DESIGN.md — impeccable craft→document fills these before code review. */}
export function ArticleBody({
  contentMd,
  rawContent,
  emptyLabel,
}: {
  contentMd: string | null;
  rawContent: string | null;
  emptyLabel: string;
}) {
  if (contentMd) {
    return (
      <div className="text-sm leading-relaxed">
        {/* DESIGN-GAP: markdown prose tokens (heading/code/blockquote/list scale + rhythm)
            not yet in DESIGN.md — impeccable craft→document fills these before code review. */}
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {contentMd}
        </ReactMarkdown>
      </div>
    );
  }
  if (rawContent) {
    return <article className="whitespace-pre-wrap text-sm leading-relaxed">{rawContent}</article>;
  }
  return <p className="text-sm text-muted">{emptyLabel}</p>;
}
