// Rail lateral: marca, navegacion por grupos, y al pie el tema y la cuenta.
//
// Los contadores de los items salen de /logs/stats, que ya se consulta para el
// dashboard: un numero al lado de "Catalog" dice de un vistazo cuanto hay, y el de
// "Upload" avisa de las subidas que se quedaron a medias.
//
// El icono de Hyperloop UPV Software va de marca de agua al fondo del pie, al 6% de
// opacidad, como el mode-selector del Electron. Se oculta al colapsar a iconos.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@hyperloopupv/frontend-kit/components";
import { SunMoon } from "@hyperloopupv/frontend-kit/icons";
import { Bookmark, CircleUser, Info, Keyboard, KeyRound } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { PAGES_ARRAY, SECTIONS } from "../../constants/pages";
import { useSavedViews } from "../../features/catalog/useSavedViews";
import { formatCount } from "../../lib/format";
import { SoftwareMark } from "../brand/SoftwareMark";
import { TeamLogo } from "../brand/TeamLogo";

interface AppSidebarProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onShowShortcuts: () => void;
  /** Contador por ruta, o undefined mientras carga. */
  counts?: Record<string, number | undefined>;
}

export function AppSidebar({
  isDark,
  onToggleTheme,
  onShowShortcuts,
  counts,
}: AppSidebarProps) {
  const { pathname } = useLocation();
  const { user, isAdmin, isMaster, signOut } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { views } = useSavedViews();

  const pages = PAGES_ARRAY.filter((page) => !page.adminOnly || isAdmin);
  // Con master key no hay cuenta detras, asi que "master_api_key" en el pie
  // parece un usuario y no lo es. Se nombra por lo que es.
  const accountName = isMaster ? "Master key" : (user?.username ?? "Account");
  const themeLabel = isDark ? "Enable light mode" : "Enable dark mode";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1">
          <TeamLogo size={28} />
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Cloud Logs</p>
              <p className="text-muted-foreground truncate text-[11px]">
                Hyperloop UPV
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {SECTIONS.map((section) => {
          const items = pages.filter((page) => page.section === section);
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={section}>
              <SidebarGroupLabel>{section}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((page) => {
                    const count = counts?.[page.url];
                    return (
                      <SidebarMenuItem key={page.url}>
                        <SidebarMenuButton
                          tooltip={page.title}
                          isActive={pathname === page.url}
                          asChild
                        >
                          <Link to={page.url}>
                            <page.icon />
                            <span>{page.title}</span>
                          </Link>
                        </SidebarMenuButton>
                        {count !== undefined && count > 0 && (
                          <SidebarMenuBadge className="tabular-nums">
                            {formatCount(count)}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
        {/* Las busquedas guardadas son atajos al catalogo, asi que van justo
            debajo de la navegacion y no en un grupo propio del mismo rango. Se
            ocultan al colapsar: un icono repetido cuatro veces no dice cual es
            cual. */}
        {views.length > 0 && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel>Saved searches</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {views.map((view) => (
                  <SidebarMenuItem key={view.id}>
                    <SidebarMenuButton tooltip={view.name} asChild>
                      <Link to={`/catalog?${view.query}`}>
                        <Bookmark />
                        <span className="truncate">{view.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="relative overflow-hidden">
        {!collapsed && (
          <SoftwareMark
            className="pointer-events-none absolute -right-4 -bottom-6 w-28 opacity-[0.06]"
            alt=""
          />
        )}
        <SidebarMenu className="relative">
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="About Cloud Logs"
              isActive={pathname === "/about"}
              asChild
            >
              <Link to="/about">
                <Info className="size-4" />
                <span>About</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Keyboard shortcuts  ( ? )"
              onClick={onShowShortcuts}
            >
              <Keyboard className="size-4" />
              <span>Shortcuts</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={themeLabel} onClick={onToggleTheme}>
              <SunMoon className="size-4" />
              <span>{themeLabel}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton tooltip={accountName}>
                  {isMaster ? (
                    <KeyRound className="size-4" />
                  ) : (
                    <CircleUser className="size-4" />
                  )}
                  <span className="truncate">{accountName}</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-48">
                <DropdownMenuLabel className="font-normal">
                  <span className="block truncate text-sm font-medium">
                    {accountName}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {isMaster
                      ? "Full access · this tab only"
                      : isAdmin
                        ? "Administrator"
                        : "Member"}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void signOut()}>
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
