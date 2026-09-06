import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { useGetIrocMe, useListIrocNotifications, getGetIrocMeQueryKey, getListIrocNotificationsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, FileText, Bell, LogOut, Globe, Settings,
  Menu, X, ChevronDown, ChevronRight, ArrowLeft, Package,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import irocLogo from "@/assets/iroc-new-logo.svg";
import { useNavConfig } from "@/hooks/use-nav-config";
import { ICON_MAP, ROUTE_REGISTRY, type NavGroup } from "@/lib/nav-config";

export default function Layout({ children }: { children: React.ReactNode }) {
  const { lang, toggleLang } = useLanguage();
  const { logout, token } = useAuth();
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);

  // ── Nav group expand/collapse — always collapsed on fresh load ────────────
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});

  const { config } = useNavConfig();
  const logoSrc = irocLogo;

  const { data: me, isError } = useGetIrocMe({
    query: {
      enabled: !!token,
      retry: false,
      // gcTime:0 — drop cache immediately on logout so a re-login never sees a stale error
      gcTime: 0,
      queryKey: getGetIrocMeQueryKey(),
    },
  });

  const { data: notifications } = useListIrocNotifications({
    query: {
      enabled: !!token,
      refetchInterval: 30000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: "always",
      queryKey: getListIrocNotificationsQueryKey(),
    },
  });

  const unreadCount = notifications?.filter((n) => !n.isRead).length || 0;

  useEffect(() => {
    if (isError) {
      queryClient.resetQueries({ queryKey: getGetIrocMeQueryKey() });
      logout();
      setLocation("/login");
    }
  }, [isError, logout, setLocation, queryClient]);

  // Auto-expand groups (and all ancestor groups) that contain the current active route.
  // Works recursively so 3-level nesting (Configuration → Website → iROC Website) is handled.
  useEffect(() => {
    const updates: Record<string, boolean> = {};
    const slugActive = (slug: string) =>
      location === slug || (slug !== "/" && location.startsWith(slug));

    function checkGroup(group: typeof config[number], ancestorIds: string[]) {
      if (group.items.some(i => slugActive(i.slug))) {
        [...ancestorIds, group.id].forEach(id => { updates[id] = true; });
      }
      (group.children ?? []).forEach(child =>
        checkGroup(child, [...ancestorIds, group.id]),
      );
    }
    config.forEach(g => checkGroup(g, []));

    if (Object.keys(updates).length === 0) return;
    setGroupOpen(prev => {
      const needsChange = Object.keys(updates).some(id => !prev[id]);
      if (!needsChange) return prev;
      return { ...prev, ...updates };
    });
  }, [location, config]);

  useEffect(() => { setMobileOpen(false); }, [location]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const toggleGroup = useCallback((id: string) => {
    setGroupOpen(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // ── Sub-components ────────────────────────────────────────────────────────

  function NavLink({
    href, label, icon: Icon, indent = false, dark = false,
  }: {
    href: string; label: string; icon: React.ElementType; indent?: boolean; dark?: boolean;
  }) {
    const isActive = location === href || (href !== "/" && location.startsWith(href));
    return (
      <Link
        href={href}
        className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          indent ? "ml-3" : ""
        } ${
          isActive
            ? "bg-primary text-white"
            : dark
              ? "text-slate-300 hover:bg-slate-700 hover:text-white"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </Link>
    );
  }

  function SectionToggle({
    label, icon: Icon, open, onToggle, dark = false,
  }: {
    label: string; icon: React.ElementType; open: boolean; onToggle: () => void; dark?: boolean;
  }) {
    return (
      <button
        onClick={onToggle}
        className={`flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
          dark
            ? "text-slate-300 hover:bg-slate-700 hover:text-white"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{label}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
    );
  }

  // Render a child sub-group at arbitrary depth.
  // depth=0 → direct child of a top-level group (e.g. "Website" inside "Configuration")
  // depth=1 → grandchild (e.g. "iROC Website" inside "Website")
  // depth=2 → great-grandchild items
  const renderChildGroup = (child: NavGroup, dark: boolean, depth: number = 0) => {
    const ChildIcon = ICON_MAP[child.icon] ?? Package;
    const childLabel = lang === "de" ? child.labelDe : child.labelEn;
    const isChildOpen = groupOpen[child.id] ?? false;

    // Indentation: 8px per level for headers, extras for items
    const mlPx = depth * 10;
    const itemMlPx = mlPx + 12;

    // ── Case A: child has its own sub-groups (e.g. "Website" → iroc-website, spirecut-website) ──
    if (child.children && child.children.length > 0) {
      const hasVisible = child.children.some(c =>
        c.children
          ? c.children.some(gc => gc.items.some(i => i.visible !== false))
          : c.items.some(i => i.visible !== false),
      );
      if (!hasVisible) return null;

      return (
        <div key={child.id} style={{ marginLeft: mlPx }}>
          <button
            onClick={() => toggleGroup(child.id)}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              dark
                ? "text-slate-400 hover:bg-slate-700 hover:text-white"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <ChildIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left">{childLabel}</span>
            {isChildOpen
              ? <ChevronDown className="h-3 w-3 opacity-60" />
              : <ChevronRight className="h-3 w-3 opacity-60" />}
          </button>
          {isChildOpen && (
            <div className="space-y-1 mt-0.5">
              {child.children.map(gc => renderChildGroup(gc, dark, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // ── Case B: regular child with direct nav items ──
    const visibleItems = child.items.filter(i => i.visible !== false);
    if (visibleItems.length === 0) return null;

    return (
      <div key={child.id} style={{ marginLeft: mlPx }}>
        <button
          onClick={() => toggleGroup(child.id)}
          className={`flex w-full items-center gap-2.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            dark
              ? "text-slate-400 hover:bg-slate-700 hover:text-white"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <ChildIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left">{childLabel}</span>
          {isChildOpen
            ? <ChevronDown className="h-3 w-3 opacity-60" />
            : <ChevronRight className="h-3 w-3 opacity-60" />}
        </button>
        {isChildOpen && (
          <div className="space-y-0.5 mt-0.5">
            {visibleItems.map(item => {
              const route = ROUTE_REGISTRY[item.slug];
              if (!route) return null;
              const ItemIcon = ICON_MAP[route.icon] ?? FileText;
              const itemLabel = lang === "de" ? route.labelDe : route.labelEn;
              return (
                <Link
                  key={item.slug}
                  href={item.slug}
                  style={{ marginLeft: itemMlPx }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    (location === item.slug || (item.slug !== "/" && location.startsWith(item.slug)))
                      ? "bg-primary text-white"
                      : dark
                        ? "text-slate-300 hover:bg-slate-700 hover:text-white"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <ItemIcon className="h-4 w-4 shrink-0" />
                  {itemLabel}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const NavLinks = ({ dark = false }: { dark?: boolean }) => (
    <div className="space-y-0.5">
      {/* Dashboard — pinned at the top, never inside a group */}
      <NavLink href="/" label={t("dashboard", lang)} icon={LayoutDashboard} dark={dark} />

      <div className={`h-px my-1.5 ${dark ? "bg-slate-700" : "bg-border/60"}`} />

      {/* Dynamic groups driven by nav config */}
      {config.map(group => {
        const GroupIcon = ICON_MAP[group.icon] ?? Package;
        const label = lang === "de" ? group.labelDe : group.labelEn;
        const isOpen = groupOpen[group.id] ?? false;

        // ── Parent branch (Website / Apps) — contains child sub-groups ──────
        if (group.children && group.children.length > 0) {
          const hasVisibleChildren = group.children.some(c =>
            c.items.some(i => i.visible !== false)
          );
          if (!hasVisibleChildren) return null;

          return (
            <div key={group.id}>
              <SectionToggle
                label={label}
                icon={GroupIcon}
                open={isOpen}
                onToggle={() => toggleGroup(group.id)}
                dark={dark}
              />
              {isOpen && (
                <div className="space-y-1 mt-0.5 pb-1">
                  {group.children.map(child => renderChildGroup(child, dark))}
                </div>
              )}
            </div>
          );
        }

        // ── Regular group — direct nav items ─────────────────────────────────
        const visibleItems = group.items.filter(i => i.visible !== false);
        if (visibleItems.length === 0) return null;

        return (
          <div key={group.id}>
            <SectionToggle
              label={label}
              icon={GroupIcon}
              open={isOpen}
              onToggle={() => toggleGroup(group.id)}
              dark={dark}
            />
            {isOpen && (
              <div className="space-y-0.5 mt-0.5">
                {visibleItems.map(item => {
                  const route = ROUTE_REGISTRY[item.slug];
                  if (!route) return null;
                  const ItemIcon = ICON_MAP[route.icon] ?? FileText;
                  const itemLabel = lang === "de" ? route.labelDe : route.labelEn;
                  return (
                    <NavLink
                      key={item.slug}
                      href={item.slug}
                      label={itemLabel}
                      icon={ItemIcon}
                      indent
                      dark={dark}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Configuration link — pinned at bottom for quick access to SMTP / Nav Tree */}
      <div className={`pt-2 mt-1 border-t ${dark ? "border-slate-700" : "border-border/40"}`}>
        <NavLink href="/configuration" label={t("configuration", lang)} icon={Settings} dark={dark} />
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] flex bg-background">
      {/* ── Desktop sidebar ──────────────────────────────────────── */}
      <aside className="w-64 border-r bg-sidebar flex-col hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b shrink-0">
          <img src={logoSrc} alt="iROC GmbH — Innovative & Regenerative medical Oriented Consultation" className="h-10 w-[190px] object-contain object-left" />
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          <NavLinks />
        </nav>

        <div className="p-4 border-t space-y-3 shrink-0">
          <div className="text-sm font-medium text-muted-foreground px-2">{me?.username}</div>
          <button
            onClick={() => { logout(); setLocation("/login"); }}
            className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {t("logout", lang)}
          </button>
        </div>
      </aside>

      {/* ── Mobile drawer backdrop ────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ────────────────────────────────────────── */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-slate-900 flex flex-col shadow-2xl
          transition-transform duration-300 ease-in-out md:hidden
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-700 shrink-0">
          <img src={logoSrc} alt="iROC GmbH — Innovative & Regenerative medical Oriented Consultation" className="h-10 w-[190px] object-contain object-left brightness-0 invert" />
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-md text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
            aria-label={t("close_menu", lang)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          <NavLinks dark />
        </nav>

        <div className="p-4 border-t border-slate-700 space-y-3 shrink-0">
          <div className="text-sm font-medium text-slate-400 px-2">{me?.username}</div>
          <button
            onClick={() => { logout(); setLocation("/login"); }}
            className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-slate-400 hover:bg-red-900/40 hover:text-red-300 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {t("logout", lang)}
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 min-w-0 border-b bg-card flex items-center justify-between px-2 md:px-6 sticky top-0 z-30 shrink-0">
          <div className="flex min-w-0 shrink items-center gap-1.5 md:gap-2">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors md:hidden"
              aria-label={t("open_menu", lang)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex h-10 w-[min(150px,32vw)] min-w-0 items-center md:hidden">
              <img src={logoSrc} alt="iROC GmbH — Innovative & Regenerative medical Oriented Consultation" className="max-h-full max-w-full object-contain object-left" />
            </div>
            {location !== "/" && (
              <button
                onClick={() => window.history.back()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label={t("go_back", lang)}
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">{lang === "de" ? "Zurück" : "Back"}</span>
              </button>
            )}
          </div>

          <div className="flex-1" />

          <div className="flex shrink-0 items-center gap-1.5 md:gap-4">
            <button
              onClick={toggleLang}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
              aria-label={t("change_language", lang)}
            >
              <Globe className="h-4 w-4" />
              {lang.toUpperCase()}
            </button>

            <Link
              href="/notifications"
              className="relative p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted"
              aria-label={t("open_notifications", lang)}
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full" />
              )}
            </Link>
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-x-hidden p-4 md:p-6 overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
