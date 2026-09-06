import { useState, useEffect } from "react";
import { useNavConfig } from "@/hooks/use-nav-config";
import {
  type NavConfig, type NavGroup,
  DEFAULT_NAV_CONFIG, ROUTE_REGISTRY, PICKER_ICONS, ICON_MAP,
} from "@/lib/nav-config";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Save, Plus, Trash2, ChevronUp, ChevronDown, RotateCcw,
  Eye, EyeOff, Loader2, MoveRight,
} from "lucide-react";

// ── NavTreeEditor ─────────────────────────────────────────────────────────────

export function NavTreeEditor() {
  const { lang } = useLanguage();
  const { toast } = useToast();
  const { config: savedConfig, saveConfig } = useNavConfig();

  const [localConfig, setLocalConfig] = useState<NavConfig>(savedConfig);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Add-group dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newLabelDe, setNewLabelDe] = useState("");
  const [newLabelEn, setNewLabelEn] = useState("");
  const [newIcon, setNewIcon] = useState("Package");

  // Delete confirmation dialog
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);

  // Sync local copy when saved config loads/changes (but not while user has unsaved edits)
  useEffect(() => {
    if (!dirty) setLocalConfig(savedConfig);
  }, [savedConfig, dirty]);

  const update = (next: NavConfig) => {
    setLocalConfig(next);
    setDirty(true);
  };

  // ── Group operations ──────────────────────────────────────────────────────

  const moveGroup = (idx: number, dir: -1 | 1) => {
    const next = [...localConfig];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    update(next);
  };

  const renameGroup = (idx: number, field: "labelDe" | "labelEn", value: string) => {
    update(localConfig.map((g, i) => i === idx ? { ...g, [field]: value } : g));
  };

  const changeGroupIcon = (idx: number, icon: string) => {
    update(localConfig.map((g, i) => i === idx ? { ...g, icon } : g));
  };

  const addGroup = () => {
    const label = newLabelEn.trim() || newLabelDe.trim();
    if (!label) return;
    const id = `group-${Date.now()}`;
    const group: NavGroup = {
      id,
      labelDe: newLabelDe.trim() || newLabelEn.trim(),
      labelEn: newLabelEn.trim() || newLabelDe.trim(),
      icon: newIcon,
      items: [],
    };
    update([...localConfig, group]);
    setExpandedGroups(prev => new Set([...prev, id]));
    setAddOpen(false);
    setNewLabelDe("");
    setNewLabelEn("");
    setNewIcon("Package");
  };

  const deleteGroup = (groupId: string) => {
    update(localConfig.filter(g => g.id !== groupId));
    setDeleteGroupId(null);
  };

  // ── Item operations ────────────────────────────────────────────────────────

  const toggleItemVisible = (groupIdx: number, slug: string) => {
    update(localConfig.map((g, gi) => gi !== groupIdx ? g : {
      ...g,
      items: g.items.map(item => item.slug === slug ? { ...item, visible: !item.visible } : item),
    }));
  };

  const moveItemToGroup = (fromGroupIdx: number, slug: string, toGroupId: string) => {
    const item = localConfig[fromGroupIdx].items.find(i => i.slug === slug);
    if (!item) return;
    update(localConfig.map((g, gi) => {
      if (gi === fromGroupIdx) return { ...g, items: g.items.filter(i => i.slug !== slug) };
      if (g.id === toGroupId) return { ...g, items: [...g.items, { ...item }] };
      return g;
    }));
  };

  // ── Save / reset ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfig(localConfig);
      setDirty(false);
      toast({
        title: lang === "de" ? "Navigationsbaum gespeichert" : "Navigation tree saved",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: lang === "de" ? "Fehler beim Speichern" : "Error saving",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    update(DEFAULT_NAV_CONFIG);
    setExpandedGroups(new Set());
  };

  // ── Expand/collapse ────────────────────────────────────────────────────────

  const toggleExpand = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const groupToDelete = deleteGroupId ? localConfig.find(g => g.id === deleteGroupId) ?? null : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {lang === "de"
            ? "Gruppen neu anordnen, umbenennen oder Routen verschieben. Änderungen sind sofort im Sidebar sichtbar nach dem Speichern."
            : "Reorder groups, rename them, or move routes between groups. Changes appear in the sidebar immediately after saving."}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" />
            {lang === "de" ? "Standard" : "Defaults"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            {lang === "de" ? "Gruppe" : "Group"}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving} className="gap-1.5">
            {saving
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Save className="w-3.5 h-3.5" />}
            {lang === "de" ? "Speichern" : "Save"}
          </Button>
        </div>
      </div>

      {dirty && (
        <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
          {lang === "de" ? "⚠ Ungespeicherte Änderungen" : "⚠ Unsaved changes"}
        </p>
      )}

      {/* Group cards */}
      <div className="space-y-2">
        {localConfig.map((group, groupIdx) => {
          const GroupIcon = ICON_MAP[group.icon] ?? ICON_MAP.Package;
          const isExpanded = expandedGroups.has(group.id);
          const visibleCount = group.items.filter(i => i.visible !== false).length;

          return (
            <div key={group.id} className="border rounded-lg bg-card overflow-hidden">
              {/* Group header row */}
              <div className="flex items-center gap-2 px-3 py-2">
                {/* Reorder arrows */}
                <div className="flex flex-col gap-0 shrink-0">
                  <button
                    onClick={() => moveGroup(groupIdx, -1)}
                    disabled={groupIdx === 0}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed"
                    title={lang === "de" ? "Nach oben" : "Move up"}
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => moveGroup(groupIdx, 1)}
                    disabled={groupIdx === localConfig.length - 1}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed"
                    title={lang === "de" ? "Nach unten" : "Move down"}
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Icon picker */}
                <Select value={group.icon} onValueChange={v => changeGroupIcon(groupIdx, v)}>
                  <SelectTrigger className="w-10 h-8 px-2 shrink-0" title={lang === "de" ? "Icon ändern" : "Change icon"}>
                    <GroupIcon className="w-4 h-4" />
                  </SelectTrigger>
                  <SelectContent className="max-h-56">
                    {PICKER_ICONS.map(p => {
                      const PIco = ICON_MAP[p.slug];
                      return (
                        <SelectItem key={p.slug} value={p.slug}>
                          <div className="flex items-center gap-2">
                            {PIco && <PIco className="w-4 h-4 shrink-0" />}
                            <span className="text-xs">{p.label}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                {/* Label inputs */}
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <Input
                    value={group.labelDe}
                    onChange={e => renameGroup(groupIdx, "labelDe", e.target.value)}
                    placeholder="DE"
                    className="h-7 text-sm flex-1 min-w-0"
                    title="Label (Deutsch)"
                  />
                  <Input
                    value={group.labelEn}
                    onChange={e => renameGroup(groupIdx, "labelEn", e.target.value)}
                    placeholder="EN"
                    className="h-7 text-sm flex-1 min-w-0"
                    title="Label (English)"
                  />
                </div>

                {/* Route count badge */}
                <Badge variant="secondary" className="shrink-0 text-xs tabular-nums">
                  {visibleCount}/{group.items.length}
                </Badge>

                {/* Delete group */}
                <button
                  onClick={() => setDeleteGroupId(group.id)}
                  className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  title={lang === "de" ? "Gruppe löschen" : "Delete group"}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                {/* Expand/collapse routes */}
                <button
                  onClick={() => toggleExpand(group.id)}
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title={isExpanded ? (lang === "de" ? "Einklappen" : "Collapse") : (lang === "de" ? "Ausklappen" : "Expand")}
                >
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>

              {/* Routes list (expanded) */}
              {isExpanded && (
                <div className="border-t">
                  {group.items.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-muted-foreground italic">
                      {lang === "de" ? "Keine Routen — verschiebe Einträge aus anderen Gruppen hierher." : "No routes — move items here from other groups."}
                    </p>
                  ) : (
                    <div className="divide-y">
                      {group.items.map(item => {
                        const route = ROUTE_REGISTRY[item.slug];
                        if (!route) return null;
                        const ItemIcon = ICON_MAP[route.icon] ?? ICON_MAP.FileText;
                        const routeLabel = lang === "de" ? route.labelDe : route.labelEn;
                        const isVisible = item.visible !== false;

                        return (
                          <div
                            key={item.slug}
                            className={`flex items-center gap-3 px-4 py-2 text-sm transition-opacity ${!isVisible ? "opacity-40" : ""}`}
                          >
                            <ItemIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="flex-1 font-medium">{routeLabel}</span>
                            <span className="text-xs text-muted-foreground font-mono hidden sm:block">
                              {item.slug}
                            </span>

                            {/* Move to another group */}
                            <Select value="" onValueChange={v => moveItemToGroup(groupIdx, item.slug, v)}>
                              <SelectTrigger
                                className="w-8 h-6 p-0 border-0 shadow-none text-muted-foreground hover:text-foreground"
                                title={lang === "de" ? "In andere Gruppe verschieben" : "Move to another group"}
                              >
                                <MoveRight className="w-3.5 h-3.5 mx-auto" />
                              </SelectTrigger>
                              <SelectContent>
                                <p className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                                  {lang === "de" ? "Verschieben nach:" : "Move to:"}
                                </p>
                                {localConfig
                                  .filter(g => g.id !== group.id)
                                  .map(g => (
                                    <SelectItem key={g.id} value={g.id}>
                                      {lang === "de" ? g.labelDe : g.labelEn}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>

                            {/* Visibility toggle */}
                            <button
                              onClick={() => toggleItemVisible(groupIdx, item.slug)}
                              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                              title={isVisible
                                ? (lang === "de" ? "Ausblenden" : "Hide")
                                : (lang === "de" ? "Anzeigen" : "Show")}
                            >
                              {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Add group dialog ───────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{lang === "de" ? "Neue Gruppe erstellen" : "Create New Group"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Label (DE)</label>
                <Input
                  value={newLabelDe}
                  onChange={e => setNewLabelDe(e.target.value)}
                  placeholder="Finanzen"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Label (EN)</label>
                <Input
                  value={newLabelEn}
                  onChange={e => setNewLabelEn(e.target.value)}
                  placeholder="Finance"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Icon</label>
              <Select value={newIcon} onValueChange={setNewIcon}>
                <SelectTrigger>
                  <div className="flex items-center gap-2">
                    {(() => { const I = ICON_MAP[newIcon]; return I ? <I className="w-4 h-4" /> : null; })()}
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {PICKER_ICONS.map(p => {
                    const PIco = ICON_MAP[p.slug];
                    return (
                      <SelectItem key={p.slug} value={p.slug}>
                        <div className="flex items-center gap-2">
                          {PIco && <PIco className="w-4 h-4 shrink-0" />}
                          {p.label}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {lang === "de" ? "Abbrechen" : "Cancel"}
            </Button>
            <Button
              onClick={addGroup}
              disabled={!newLabelDe.trim() && !newLabelEn.trim()}
            >
              {lang === "de" ? "Erstellen" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ─────────────────────────────────────────── */}
      <Dialog open={!!deleteGroupId} onOpenChange={() => setDeleteGroupId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {lang === "de" ? "Gruppe löschen?" : "Delete group?"}
            </DialogTitle>
          </DialogHeader>
          {groupToDelete && (
            <p className="text-sm text-muted-foreground">
              {lang === "de"
                ? `Die Gruppe „${groupToDelete.labelDe}" enthält ${groupToDelete.items.length} Route(n). Diese werden aus dem Navigationsbaum entfernt. Du kannst sie über „Standard" zurücksetzen.`
                : `The group "${groupToDelete.labelEn}" contains ${groupToDelete.items.length} route(s). They will be removed from the nav tree. Use "Defaults" to restore them.`}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteGroupId(null)}>
              {lang === "de" ? "Abbrechen" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteGroupId && deleteGroup(deleteGroupId)}
            >
              {lang === "de" ? "Löschen" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
