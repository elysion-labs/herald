import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface SearchableOption {
  value: string;
  label: string;
  /** 额外参与搜索的文本，例如 id。 */
  keywords?: string[];
}

/** shadcn Combobox：Popover + Command，可输入筛选。 */
export function SearchableSelect({
  id,
  value,
  options,
  onChange,
  placeholder = '请选择',
  searchPlaceholder = '搜索',
  emptyText = '没有匹配项',
}: {
  id?: string;
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = options.find(option => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          className="w-full justify-between font-normal"
        >
          <span className={selected ? 'truncate' : 'text-muted-foreground truncate'}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) overflow-hidden p-0"
        align="start"
      >
        <Command>
          <div className="border-border border-b">
            <CommandInput placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
          </div>
          <CommandList id={listId}>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.label, ...(option.keywords ?? [])]}
                  data-checked={option.value === value}
                  onSelect={next => {
                    onChange(next);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
