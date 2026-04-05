"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

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

function TabsTab({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "px-4 py-2 text-sm font-medium text-muted transition-colors",
        "border-b-2 border-transparent -mb-px",
        "hover:text-foreground",
        "data-[selected]:border-primary data-[selected]:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        className,
      )}
      {...props}
    />
  )
}

function TabsPanel({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      className={cn("mt-4 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTab, TabsPanel }
