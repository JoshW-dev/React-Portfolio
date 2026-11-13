import Cinemagraph from "@/components/Cinemagraph";

type Props = { className?: string; priority?: boolean };

/** Josh's portrait. The person holds still and the background moves. */
export default function Portrait({ className, priority }: Props) {
  return (
    <Cinemagraph
      src="/img/josh.webp"
      width={560}
      height={720}
      alt="Josh Wade smiling in a winter jacket, with snowy mountains behind him"
      className={className}
      priority={priority}
    />
  );
}
