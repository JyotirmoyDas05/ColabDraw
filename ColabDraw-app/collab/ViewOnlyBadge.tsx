import clsx from "clsx";

import { Button } from "@excalidraw/excalidraw/components/Button";
import { eyeIcon } from "@excalidraw/excalidraw/components/icons";

import "./ViewOnlyBadge.scss";

/**
 * Shown while you're in a room through a view-only link. Clicking it opens the
 * share dialog, where you can copy the link or leave.
 */
const ViewOnlyBadge = ({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) => {
  return (
    <Button
      className={clsx("view-only-badge", className)}
      type="button"
      onSelect={onClick}
      title="You can see this drawing but not edit it"
    >
      {eyeIcon}
      <span>View only</span>
    </Button>
  );
};

export default ViewOnlyBadge;
