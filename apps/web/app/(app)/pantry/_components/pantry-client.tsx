"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowDownAZ,
  Check,
  CheckSquare,
  History,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button, Input, cn } from "@dishes/ui";
import {
  addStaple,
  addStockItem,
  removeStaples,
  removeStockItems,
  updateStockItem,
} from "@/app/actions/pantry";

interface Staple {
  id: string;
  ingredientName: string;
}

interface StockItem {
  id: string;
  ingredientName: string;
  amount: string | null;
  unit: string | null;
  addedAt: Date;
}

interface Props {
  staples: Staple[];
  stock: StockItem[];
}

function formatAmount(amount: string | null): string {
  if (!amount) return "";
  const n = parseFloat(amount);
  if (isNaN(n)) return amount;
  return n % 1 === 0 ? String(n) : parseFloat(n.toFixed(2)).toString();
}

type StockSort = "alpha" | "recent";

export function PantryClient({ staples, stock }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<StockSort>("alpha");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedStaples, setSelectedStaples] = useState<Set<string>>(new Set());
  const [selectedStock, setSelectedStock] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const filteredStaples = useMemo(
    () => (q ? staples.filter((s) => s.ingredientName.toLowerCase().includes(q)) : staples),
    [staples, q]
  );
  const filteredStock = useMemo(() => {
    const filtered = q
      ? stock.filter((s) => s.ingredientName.toLowerCase().includes(q))
      : stock;
    if (sort === "recent") {
      return [...filtered].sort(
        (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
      );
    }
    return filtered; // already A–Z from the server query
  }, [stock, q, sort]);

  const selectedCount = selectedStaples.size + selectedStock.size;

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedStaples(new Set());
    setSelectedStock(new Set());
  }

  function toggleStaple(id: string) {
    setSelectedStaples((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleStock(id: string) {
    setSelectedStock((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allStaplesSelected =
    filteredStaples.length > 0 &&
    filteredStaples.every((s) => selectedStaples.has(s.id));
  const allStockSelected =
    filteredStock.length > 0 && filteredStock.every((s) => selectedStock.has(s.id));

  function toggleAllStaples() {
    setSelectedStaples(
      allStaplesSelected ? new Set() : new Set(filteredStaples.map((s) => s.id))
    );
  }

  function toggleAllStock() {
    setSelectedStock(
      allStockSelected ? new Set() : new Set(filteredStock.map((s) => s.id))
    );
  }

  function deleteSelected() {
    if (selectedCount === 0) return;
    if (!window.confirm(`Delete ${selectedCount} item${selectedCount !== 1 ? "s" : ""} from the pantry?`)) {
      return;
    }
    const stapleIds = Array.from(selectedStaples);
    const stockIds = Array.from(selectedStock);
    startTransition(async () => {
      await Promise.all([
        stapleIds.length ? removeStaples(stapleIds) : Promise.resolve(),
        stockIds.length ? removeStockItems(stockIds) : Promise.resolve(),
      ]);
      exitSelectMode();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar: search + select mode — sticky so it stays usable in long lists */}
      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-2 rounded-lg bg-background/95 px-2 py-2 backdrop-blur-sm">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pantry…"
            className="pl-9"
            type="search"
          />
        </div>

        <div
          className="flex items-center rounded-lg border bg-background p-0.5"
          role="radiogroup"
          aria-label="Sort stock"
        >
          {(
            [
              { value: "alpha", label: "A–Z", icon: ArrowDownAZ },
              { value: "recent", label: "Recent", icon: History },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setSort(value)}
              role="radio"
              aria-checked={sort === value}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                sort === value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {selectMode ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground tabular-nums">
              {selectedCount} selected
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={deleteSelected}
              disabled={pending || selectedCount === 0}
              className="gap-1.5"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={exitSelectMode} disabled={pending}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectMode(true)}
            className="gap-1.5"
          >
            <CheckSquare className="h-4 w-4" />
            Select
          </Button>
        )}
      </div>

      <StaplesCard
        staples={filteredStaples}
        totalCount={staples.length}
        filtering={q.length > 0}
        selectMode={selectMode}
        selected={selectedStaples}
        onToggle={toggleStaple}
        allSelected={allStaplesSelected}
        onToggleAll={toggleAllStaples}
      />

      <StockCard
        items={filteredStock}
        totalCount={stock.length}
        filtering={q.length > 0}
        selectMode={selectMode}
        selected={selectedStock}
        onToggle={toggleStock}
        allSelected={allStockSelected}
        onToggleAll={toggleAllStock}
      />
    </div>
  );
}

// ─── Staples ──────────────────────────────────────────────────────────────────

function StaplesCard({
  staples,
  totalCount,
  filtering,
  selectMode,
  selected,
  onToggle,
  allSelected,
  onToggleAll,
}: {
  staples: Staple[];
  totalCount: number;
  filtering: boolean;
  selectMode: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  allSelected: boolean;
  onToggleAll: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleAdd(formData: FormData) {
    const name = (formData.get("ingredientName") as string)?.trim();
    if (!name) return;
    startTransition(async () => {
      await addStaple(name);
      if (inputRef.current) {
        inputRef.current.value = "";
        inputRef.current.focus();
      }
    });
  }

  function handleRemove(id: string) {
    startTransition(() => removeStaples([id]));
  }

  return (
    <section className="rounded-xl border bg-gradient-to-br from-amber-500/5 via-card to-card p-4 sm:p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold leading-tight">
              Staples
              <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                {filtering ? `${staples.length} of ${totalCount}` : totalCount}
              </span>
            </h2>
            <p className="text-sm text-muted-foreground">
              Always on hand — excluded from shopping lists automatically.
            </p>
          </div>
        </div>

        {selectMode && (
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleAll}
            disabled={staples.length === 0}
            className="gap-1.5"
          >
            <CheckSquare className="h-4 w-4" />
            {allSelected ? "Deselect all" : filtering ? "Select all shown" : "Select all"}
          </Button>
        )}

        {!selectMode && (
          <form action={handleAdd} className="flex gap-2">
            <Input
              ref={inputRef}
              name="ingredientName"
              placeholder="e.g. Olive oil"
              className="w-44 bg-background"
              disabled={pending}
            />
            <Button type="submit" size="sm" disabled={pending} className="gap-1">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </form>
        )}
      </div>

      {staples.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {staples.map((staple) => {
            const isSelected = selected.has(staple.id);
            return (
              <li key={staple.id}>
                {selectMode ? (
                  <button
                    onClick={() => onToggle(staple.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    )}
                    aria-pressed={isSelected}
                  >
                    {isSelected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    {staple.ingredientName}
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 rounded-full border bg-background pl-3 pr-1.5 py-1 text-sm shadow-sm">
                    {staple.ingredientName}
                    <button
                      onClick={() => handleRemove(staple.id)}
                      disabled={pending}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
                      aria-label={`Remove ${staple.ingredientName}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          {filtering
            ? "No staples match your search."
            : "No staples yet — add things like olive oil, salt, or garlic."}
        </p>
      )}
    </section>
  );
}

// ─── Stock ────────────────────────────────────────────────────────────────────

function StockCard({
  items,
  totalCount,
  filtering,
  selectMode,
  selected,
  onToggle,
  allSelected,
  onToggleAll,
}: {
  items: StockItem[];
  totalCount: number;
  filtering: boolean;
  selectMode: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  allSelected: boolean;
  onToggleAll: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleAdd(formData: FormData) {
    startTransition(async () => {
      await addStockItem(formData);
      formRef.current?.reset();
      formRef.current?.querySelector<HTMLInputElement>("input[name=ingredientName]")?.focus();
    });
  }

  return (
    <section className="rounded-xl border bg-gradient-to-br from-emerald-500/5 via-card to-card p-4 sm:p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold leading-tight">
              Current Stock
              <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                {filtering ? `${items.length} of ${totalCount}` : totalCount}
              </span>
            </h2>
            <p className="text-sm text-muted-foreground">
              What you have on hand — skipped when building shopping lists.
            </p>
          </div>
        </div>

        {selectMode && (
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleAll}
            disabled={items.length === 0}
            className="gap-1.5"
          >
            <CheckSquare className="h-4 w-4" />
            {allSelected ? "Deselect all" : filtering ? "Select all shown" : "Select all"}
          </Button>
        )}

        {!selectMode && (
          <form ref={formRef} action={handleAdd} className="flex flex-wrap gap-2">
            <Input
              name="ingredientName"
              placeholder="Ingredient"
              className="w-40 bg-background"
              disabled={pending}
              required
            />
            <Input
              name="amount"
              placeholder="Amt"
              className="w-20 bg-background"
              disabled={pending}
              type="number"
              min="0"
              step="any"
            />
            <Input
              name="unit"
              placeholder="Unit"
              className="w-20 bg-background"
              disabled={pending}
            />
            <Button type="submit" size="sm" disabled={pending} className="gap-1">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </form>
        )}
      </div>

      {items.length > 0 ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <StockRow
              key={item.id}
              item={item}
              selectMode={selectMode}
              selected={selected.has(item.id)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          {filtering
            ? "No stock items match your search."
            : "No stock items yet. They'll appear here when you add them or finish cooking a recipe."}
        </p>
      )}
    </section>
  );
}

function StockRow({
  item,
  selectMode,
  selected,
  onToggle,
}: {
  item: StockItem;
  selectMode: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  function handleSave(formData: FormData) {
    const ingredientName = (formData.get("ingredientName") as string)?.trim();
    if (!ingredientName) return;
    const amount = (formData.get("amount") as string)?.trim() || null;
    const unit = (formData.get("unit") as string)?.trim() || null;
    startTransition(async () => {
      await updateStockItem(item.id, { ingredientName, amount, unit });
      setEditing(false);
    });
  }

  function handleRemove() {
    startTransition(() => removeStockItems([item.id]));
  }

  if (selectMode) {
    return (
      <li>
        <button
          onClick={() => onToggle(item.id)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
            selected ? "border-primary bg-primary/10" : "bg-background hover:bg-muted"
          )}
          aria-pressed={selected}
        >
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
              selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
            )}
          >
            {selected && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
          <span className="flex-1 min-w-0 truncate text-sm font-medium">{item.ingredientName}</span>
          {(item.amount || item.unit) && (
            <span className="shrink-0 text-sm text-muted-foreground">
              {formatAmount(item.amount)}
              {item.unit ? ` ${item.unit}` : ""}
            </span>
          )}
        </button>
      </li>
    );
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-primary/40 bg-background px-3 py-2 shadow-sm">
        <form action={handleSave} className="flex items-center gap-1.5">
          <Input
            name="ingredientName"
            defaultValue={item.ingredientName}
            className="h-8 flex-1 min-w-0 text-sm"
            disabled={pending}
            autoFocus
            required
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          />
          <Input
            name="amount"
            defaultValue={formatAmount(item.amount)}
            className="h-8 w-16 text-sm"
            disabled={pending}
            type="number"
            min="0"
            step="any"
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          />
          <Input
            name="unit"
            defaultValue={item.unit ?? ""}
            className="h-8 w-14 text-sm"
            disabled={pending}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          />
          <button
            type="submit"
            disabled={pending}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            aria-label="Save"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={pending}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-2 rounded-lg border bg-background px-3 py-2.5 shadow-sm">
      <span className="flex-1 min-w-0 truncate text-sm font-medium">{item.ingredientName}</span>
      {(item.amount || item.unit) && (
        <span className="shrink-0 text-sm text-muted-foreground">
          {formatAmount(item.amount)}
          {item.unit ? ` ${item.unit}` : ""}
        </span>
      )}
      <button
        onClick={() => setEditing(true)}
        className="shrink-0 text-muted-foreground/40 hover:text-foreground transition-colors sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        aria-label={`Edit ${item.ingredientName}`}
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        onClick={handleRemove}
        disabled={pending}
        className="shrink-0 text-muted-foreground/40 hover:text-destructive transition-colors sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        aria-label={`Remove ${item.ingredientName}`}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </li>
  );
}
