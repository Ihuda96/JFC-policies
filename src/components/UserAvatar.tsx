import { avatarPublicUrl } from "../lib/avatar";
import type { Profile } from "../lib/types";

interface UserAvatarProps {
  profile?: Pick<Profile, "avatar_path"> | null;
  isSuperAdmin?: boolean;
  className?: string;
  /** Base class carrying the size/shape (defaults to the main app's
   *  circular ".avatar" — the executive portal passes its own
   *  rounded-square ".profile-avatar" to match its own design system). */
  baseClassName?: string;
}

/** A user's own uploaded photo, or — when none is set — the JFHC star
 *  badge, never a bare initial letter. */
export function UserAvatar({ profile, isSuperAdmin, className, baseClassName = "avatar" }: UserAvatarProps) {
  const url = avatarPublicUrl(profile?.avatar_path);
  const classes = [baseClassName, isSuperAdmin ? "avatar-super" : "", className].filter(Boolean).join(" ");

  if (url) {
    return <img className={`${classes} avatar-photo`} src={url} alt="" />;
  }

  return (
    <span className={classes}>
      <img className="avatar-badge-icon" src="/brand/jfc-star-white.png" alt="" />
    </span>
  );
}
