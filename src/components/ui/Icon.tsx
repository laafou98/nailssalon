import { ICONS } from "./icon-data";

export type IconName = keyof typeof ICONS;

export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const { viewBox, body } = ICONS[name];
  return <svg width={size} height={size} viewBox={viewBox} aria-hidden dangerouslySetInnerHTML={{ __html: body }} />;
}
