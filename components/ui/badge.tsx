import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        // Tags are neutral (direction 1g): orange is kept for the primary
        // button, focus, the active-nav bar and the last chart point. The
        // word always stays in the text colour; only the wash carries tone.
        default: "bg-foreground text-background [a]:hover:bg-foreground/85",
        secondary: "bg-selected text-foreground [a]:hover:bg-accent",
        destructive:
          "border-destructive/45 bg-destructive/10 text-foreground [a]:hover:bg-destructive/20",
        outline: "border-line-strong text-foreground [a]:hover:bg-hover",
        ghost: "hover:bg-hover hover:text-foreground",
        link: "text-foreground underline underline-offset-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
