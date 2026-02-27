"use client"

import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "../lib/utils"

const Tabs = TabsPrimitive.Root

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex border-b border-border", className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "px-4 py-2 text-sm font-medium text-muted transition-colors",
        "border-b-2 border-transparent -mb-px",
        "hover:text-foreground",
        "data-[state=active]:border-primary data-[state=active]:text-foreground",
        "outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("mt-4 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
