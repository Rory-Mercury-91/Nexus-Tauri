import { ProfileAvatarImage } from "@/components/common/ProfileAvatarImage";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";

export type OwnerToggleItem = {
  id: string;
  displayName: string;
  avatarStoragePath?: string | null;
};

type OwnerToggleListProps = {
  items: OwnerToggleItem[];
  selectedIds: string[];
  onToggle: (ownerId: string, checked: boolean) => void;
  disabled?: boolean;
  avatarSize?: number;
  listClassName: string;
  rowClassName: string;
  mainClassName: string;
};

export function OwnerToggleList({
  items,
  selectedIds,
  onToggle,
  disabled = false,
  avatarSize = 32,
  listClassName,
  rowClassName,
  mainClassName,
}: OwnerToggleListProps) {
  return (
    <ul className={listClassName}>
      {items.map((item) => {
        const checked = selectedIds.includes(item.id);
        return (
          <li key={item.id}>
            <div className={rowClassName}>
              <ToggleSwitch
                checked={checked}
                onChange={(nextChecked) => onToggle(item.id, nextChecked)}
                disabled={disabled}
              />
              <span className={mainClassName}>
                <ProfileAvatarImage
                  storagePath={item.avatarStoragePath ?? undefined}
                  displayName={item.displayName || item.id}
                  size={avatarSize}
                />
                <span>{item.displayName || item.id.slice(0, 8)}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
