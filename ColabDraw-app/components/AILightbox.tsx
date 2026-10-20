import "./AIComposer.scss";

/** A picture shown large over the board; click or Esc to close. */
export const AILightbox = ({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) => (
  <div
    className="ai-composer__lightbox"
    role="dialog"
    aria-modal="true"
    aria-label={name}
    onClick={onClose}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }}
  >
    <img src={url} alt={name} />
    <button
      type="button"
      className="ai-composer__lightbox-close"
      aria-label="Close preview"
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      onClick={onClose}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  </div>
);
