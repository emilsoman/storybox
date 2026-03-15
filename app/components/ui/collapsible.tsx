import * as React from "react"
import { Slot } from "radix-ui"
import { cn } from "~/lib/utils"

type CollapsibleContextValue = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CollapsibleContext = React.createContext<CollapsibleContextValue | null>(
  null,
)

function useCollapsible() {
  const ctx = React.useContext(CollapsibleContext)
  if (!ctx)
    throw new Error("Collapsible components must be used within Collapsible")
  return ctx
}

const Collapsible = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
  }
>(function Collapsible(
  {
    open: controlledOpen,
    defaultOpen,
    onOpenChange,
    className,
    children,
    ...props
  },
  ref,
) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    defaultOpen ?? false,
  )
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )
  return (
    <CollapsibleContext.Provider value={{ open, onOpenChange: setOpen }}>
      <div
        ref={ref}
        data-state={open ? "open" : "closed"}
        className={cn(className)}
        {...props}
      >
        {children}
      </div>
    </CollapsibleContext.Provider>
  )
})

const CollapsibleTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { asChild?: boolean }
>(function CollapsibleTrigger(
  { className, asChild, children, onClick, ...props },
  ref,
) {
  const ctx = useCollapsible()
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    ctx.onOpenChange(!ctx.open)
    onClick?.(e)
  }
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      ref={ref}
      type="button"
      onClick={handleClick}
      data-state={ctx.open ? "open" : "closed"}
      className={cn(className)}
      {...props}
    >
      {children}
    </Comp>
  )
})

const CollapsibleContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(function CollapsibleContent({ className, children, ...props }, ref) {
  const ctx = useCollapsible()
  return (
    <div
      ref={ref}
      data-state={ctx.open ? "open" : "closed"}
      className={cn(
        "grid transition-[grid-template-rows] duration-200 ease-out data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]",
        className,
      )}
      {...props}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
})

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
