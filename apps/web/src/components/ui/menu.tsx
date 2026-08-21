"use client";

import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { ChevronDown } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "./button";

interface DropdownItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

interface DropdownMenuProps {
  trigger: string;
  items: DropdownItem[];
}

export function DropdownMenu({ trigger, items }: DropdownMenuProps) {
  return (
    <DropdownPrimitive.Root>
      <DropdownPrimitive.Trigger asChild>
        <Button aria-label={trigger}>
          {trigger}
          <ChevronDown aria-hidden="true" size={18} />
        </Button>
      </DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content className="ui-menu-content" sideOffset={8} align="end">
          {items.map((item) => (
            <DropdownPrimitive.Item
              className="ui-menu-item"
              data-destructive={item.destructive || undefined}
              key={item.label}
              onSelect={item.onSelect}
              {...(item.disabled === undefined ? {} : { disabled: item.disabled })}
            >
              {item.label}
            </DropdownPrimitive.Item>
          ))}
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  );
}

interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  label: string;
  tabs: readonly [TabItem, ...TabItem[]];
  defaultValue?: string;
}

export function Tabs({ label, tabs, defaultValue = tabs[0].value }: TabsProps) {
  return (
    <TabsPrimitive.Root className="ui-tabs" defaultValue={defaultValue}>
      <TabsPrimitive.List aria-label={label} className="ui-tabs-list">
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger className="ui-tab-trigger" key={tab.value} value={tab.value}>
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content className="ui-tab-content" key={tab.value} value={tab.value}>
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

interface TooltipProps {
  content: string;
  children: ReactElement;
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="ui-tooltip" sideOffset={8}>
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
