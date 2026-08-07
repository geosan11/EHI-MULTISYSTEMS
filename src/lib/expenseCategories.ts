import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';
import { EXPENSE_CATEGORIES } from './constants.js';

export const EXPENSE_CATEGORIES_CACHE_KEY = 'ehi_expense_categories';

export interface ExpenseCategory {
  id: string;
  name: string;
}

export interface ExpenseCategoriesOptions {
  coldFallback?: boolean;
}

// Cold fallback has no real DB id -- nothing to key a budget write against
// offline. Callers that only need the name (PackageForm.tsx,
// MarketingWorkspace.tsx's expense-category dropdowns) are unaffected;
// only the budget editor (ExpensesTab.tsx) needs a real id, and budget
// writes require network anyway.
function coldFallbackCategories(): ExpenseCategory[] {
  return EXPENSE_CATEGORIES.map(name => ({ id: '', name }));
}

export function getCachedExpenseCategories(opts: ExpenseCategoriesOptions = {}): ExpenseCategory[] {
  const { coldFallback = true } = opts;
  try {
    const parsed = JSON.parse(localStorage.getItem(EXPENSE_CATEGORIES_CACHE_KEY) || 'null');
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // ignore -- treated the same as an empty cache
  }
  return coldFallback ? coldFallbackCategories() : [];
}

export async function fetchExpenseCategories(): Promise<ExpenseCategory[] | null> {
  const { data, error } = await supabase.from('expense_categories').select('id, name').eq('active', true).order('name');
  if (!data || error || data.length === 0) return null;
  try {
    localStorage.setItem(EXPENSE_CATEGORIES_CACHE_KEY, JSON.stringify(data));
  } catch {
    // localStorage unavailable -- nothing to persist to, the fetch result is still returned
  }
  return data;
}

// Cached/fallback list on first render (instant paint, works offline);
// swaps to the live Supabase list once the fetch resolves. Callers that
// only need names (dropdown consumers) should map `.map(c => c.name)`.
// Periodic + focus/visibility refresh, matching officeWork.ts's corpRates
// pattern -- without it, an admin editing categories mid-shift was invisible
// to any expense form tab already open elsewhere until it happened to remount.
export function useExpenseCategories(opts: ExpenseCategoriesOptions = {}): ExpenseCategory[] {
  const [categories, setCategories] = useState<ExpenseCategory[]>(() => getCachedExpenseCategories(opts));
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { fetchExpenseCategories().then(data => { if (data && !cancelled) setCategories(data); }); };
    refresh();
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return categories;
}

// --- Per-month budgets -- ExpensesTab.tsx-specific, not needed by the
// plain category-name dropdowns above. ---

export interface CategoryBudget {
  categoryId: string;
  name: string;
  budget: number;
  /** False when this month has no row yet and `budget` is only a pre-fill
   * carried forward from the most recent prior month with one. */
  hasRowForMonth: boolean;
}

export function useExpenseBudgets(monthKey: string): { budgets: CategoryBudget[]; loading: boolean; refetch: () => void } {
  const [budgets, setBudgets] = useState<CategoryBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [gen, setGen] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: categories } = await supabase.from('expense_categories').select('id, name').eq('active', true).order('name');
      if (!categories || categories.length === 0) {
        if (!cancelled) { setBudgets([]); setLoading(false); }
        return;
      }
      const categoryIds = categories.map((c: any) => c.id);
      const [{ data: thisMonth }, { data: priorRows }] = await Promise.all([
        supabase.from('expense_budgets').select('category_id, budget').eq('month', monthKey).in('category_id', categoryIds),
        // Most recent prior month per category, used as a display pre-fill
        // (not written) when this month has no row yet -- so opening a new
        // month doesn't reset every budget to zero and force re-entry.
        supabase.from('expense_budgets').select('category_id, month, budget').lt('month', monthKey).in('category_id', categoryIds).order('month', { ascending: false }),
      ]);
      if (cancelled) return;
      const thisMonthMap = new Map<string, number>((thisMonth || []).map((b: any) => [b.category_id, Number(b.budget)]));
      const latestPriorMap = new Map<string, number>();
      (priorRows || []).forEach((b: any) => {
        if (!latestPriorMap.has(b.category_id)) latestPriorMap.set(b.category_id, Number(b.budget));
      });
      const merged: CategoryBudget[] = categories.map((c: any) => ({
        categoryId: c.id,
        name: c.name,
        budget: thisMonthMap.has(c.id) ? thisMonthMap.get(c.id)! : (latestPriorMap.get(c.id) ?? 0),
        hasRowForMonth: thisMonthMap.has(c.id),
      }));
      setBudgets(merged);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [monthKey, gen]);

  return { budgets, loading, refetch: () => setGen(g => g + 1) };
}

export async function saveExpenseBudget(categoryId: string, month: string, budget: number): Promise<string | null> {
  const { error } = await supabase.from('expense_budgets').upsert({
    category_id: categoryId,
    month,
    budget,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'category_id,month' });
  return error ? error.message : null;
}
