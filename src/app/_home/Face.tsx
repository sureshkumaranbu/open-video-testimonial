import type { SamplePerson } from "./samples";

/**
 * A sample person's face. Decorative (the name is always next to it), sized
 * up front so it never shifts layout, and lazy unless it's above the fold.
 */
export function Face({
  person,
  size = 40,
  className = "face",
  eager = false,
}: {
  person: SamplePerson;
  size?: number;
  className?: string;
  eager?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={person.avatar}
      alt=""
      width={size}
      height={size}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      data-face={person.id}
    />
  );
}
