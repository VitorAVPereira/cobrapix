import Image from "next/image";

interface BrandLogoProps {
  variant?: "primary" | "reverse";
  className?: string;
  width: number;
  height: number;
  priority?: boolean;
}

export function BrandLogo({
  variant = "primary",
  className,
  width,
  height,
  priority = false,
}: BrandLogoProps) {
  return (
    <Image
      src={`/brand/cifra-plus-${variant}.svg`}
      alt="Cifra+"
      width={width}
      height={height}
      className={className}
      priority={priority}
    />
  );
}
