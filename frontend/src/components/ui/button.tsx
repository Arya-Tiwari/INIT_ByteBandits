import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
const variants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[3px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-[#4A342A] text-[#F5F1E8] hover:bg-[#654A3D] border border-[#4A342A] px-4 py-2.5 shadow-none",
        outline:
          "border border-[#CFC4B4] bg-[#F5F1E8] text-[#4A342A] hover:bg-[#F7EFE0] hover:border-[#4A342A] px-4 py-2.5 shadow-none",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={twMerge(clsx(variants({ variant, className })))}
      {...props}
    />
  );
}
