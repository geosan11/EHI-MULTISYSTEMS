import { useState, useEffect } from "react";
import ehiLogo from '../assets/branding/ehi-logo.png';
import {
  HouseIcon,
  PackageIcon,
  TrendUpIcon,
  AirplaneIcon,
  QrCodeIcon,
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  DotsThreeIcon,
  TruckIcon,
  SignOutIcon,
  SunIcon,
  MoonIcon,
} from "@phosphor-icons/react";
import { User, TabView, ExcessBaggageAirline } from "../lib/types";
import { Theme } from "../lib/useTheme";
import { getAllowedTabs } from "../lib/permissions";

// Icon/label lookup for the static views -- getAllowedTabs (src/lib/permissions.ts)
// is the single source of truth for WHICH ids a user can see (role default
// or their super-admin-set override); this is purely presentational.
const VIEW_ICON: Record<string, any> = {
  Tower: HouseIcon,
  Cargo: PackageIcon,
  Marketing: TrendUpIcon,
  Packages: TruckIcon,
  Scan: QrCodeIcon,
  Incoming: ArrowLineDownIcon,
  OutboundArrivals: ArrowLineUpIcon,
  MyTrips: TruckIcon,
  More: DotsThreeIcon,
};
const VIEW_LABEL: Record<string, string> = {
  Tower: "Dashboard",
  Cargo: "Cargo Entry",
  Marketing: "Marketing",
  Packages: "Package Desk",
  Scan: "QR Scanner",
  Incoming: "Incoming To Hub",
  OutboundArrivals: "Outbound Arrivals",
  MyTrips: "My Trips",
  More: "More",
};
export const SideNav = ({
  user,
  currentTab,
  onChangeTab,
  onLogout,
  theme,
  onToggleTheme,
  excessBaggageAirlines,
}: {
  user: User;
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
  onLogout: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  excessBaggageAirlines: ExcessBaggageAirline[];
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    // Check local storage or window size for initial state
    const saved = localStorage.getItem("ehi_sidebar_expanded");
    if (saved !== null) {
      setIsExpanded(saved === "true");
    } else {
      setIsExpanded(window.innerWidth >= 1200);
    }
  }, []);

  const handleToggleExpand = () => {
    const nextState = !isExpanded;
    setIsExpanded(nextState);
    localStorage.setItem("ehi_sidebar_expanded", String(nextState));
  };

  // The nav is position:fixed (floats above the page instead of sitting in
  // normal flex flow), so .ehi-main-content can no longer rely on flexbox
  // to make room for it -- it reads this CSS var (set on the root so no
  // prop-drilling into EHIApp is needed) to reserve matching space, kept in
  // sync with the same width this component renders at.
  useEffect(() => {
    const width = isExpanded ? 220 : 72;
    document.documentElement.style.setProperty("--sidenav-offset", `${width + 20}px`);
  }, [isExpanded]);

  // getAllowedTabs is the single source of truth for which ids this user
  // can see -- their super-admin-set view_overrides if present, else the
  // normal role-derived default (src/lib/permissions.ts). This component
  // only decides how to DISPLAY whatever ids come back.
  const allowedTabs = getAllowedTabs(user, excessBaggageAirlines);
  const allowedSet = new Set(allowedTabs);

  const baggageEntries = allowedTabs
    .filter((id) => id.startsWith("Baggage:"))
    .map((id) => {
      const airlineName = id.slice("Baggage:".length);
      return {
        id,
        icon: AirplaneIcon,
        label: user.role === "baggage_agent" ? airlineName : `${airlineName} POS`,
      };
    });

  // Baggage entries always sit between Marketing and Packages regardless of
  // whether Marketing/Packages themselves are in this user's allowed set --
  // a baggage_agent (who has no Marketing access at all) must still see
  // their own airline tab, so the split can't be conditional on Marketing
  // surviving the filter.
  const toEntries = (ids: TabView[]) => ids.filter((id) => allowedSet.has(id)).map((id) => ({ id, icon: VIEW_ICON[id], label: VIEW_LABEL[id] }));
  const visibleTabs = [
    ...toEntries(["Tower", "Cargo", "Marketing"]),
    ...baggageEntries,
    ...toEntries(["Packages", "Scan", "Incoming", "OutboundArrivals", "MyTrips", "More"]),
  ];

  return (
    <aside
      className={`ehi-sidenav ${isExpanded ? "expanded" : "collapsed"}`}
      style={{
        display: "flex",
        flexDirection: "column",
        width: isExpanded ? 220 : 72,
        position: "fixed",
        top: 10,
        left: 10,
        zIndex: 30,
        background: "var(--color-surface-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-2xl)",
        boxShadow: "var(--shadow-dropdown)",
        flexShrink: 0,
        height: "calc(var(--app-height) - 20px)",
        overflowY: "auto",
        overflowX: "hidden",
        transition: "width 0.3s cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      {/* Brand */}
      <div
        style={{
          padding: isExpanded ? "12px 12px 8px" : "12px 0 8px",
          display: "flex",
          flexDirection: "column",
          alignItems: isExpanded ? "flex-start" : "center",
          transition: "all 0.3s cubic-bezier(0.2, 0, 0, 1)",
          flexShrink: 0,
        }}
      >
        <div
          className={`flex items-center cursor-pointer hover:opacity-80 transition-opacity ${isExpanded ? "gap-2.5" : "justify-center w-full"}`}
          style={{ minHeight: 36 }}
          onClick={handleToggleExpand}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "rgba(245,158,11,0.12)",
              border: "1px solid rgba(245,158,11,0.25)",
              boxShadow: "0 2px 10px rgba(245,158,11,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <img
              src={ehiLogo}
              alt="EHI"
              style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 8 }}
              onError={(e) => {
                // Falls back to the original text treatment if the file is
                // missing or fails to load, rather than showing a broken image icon
                (e.target as HTMLImageElement).style.display = 'none';
                const fallback = document.createElement('span');
                fallback.textContent = 'EHI';
                fallback.style.cssText = "font-family:'JetBrains Mono',monospace;font-weight:800;font-size:14px;color:#F59E0B;";
                (e.target as HTMLImageElement).parentElement?.appendChild(fallback);
              }}
            />
          </div>

          <div
            className="ehi-sidebar-brand"
            style={{
              opacity: isExpanded ? 1 : 0,
              width: isExpanded ? "auto" : 0,
              overflow: "hidden",
              transition:
                "opacity 0.2s ease, width 0.3s cubic-bezier(0.2, 0, 0, 1)",
              whiteSpace: "nowrap",
            }}
          >
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                fontWeight: 900,
                color: "var(--color-foreground, #F1F5F9)",
                letterSpacing: "0.03em",
                lineHeight: 1.1,
              }}
            >
              MULTISYSTEMS
            </div>
            <div
              style={{
                fontSize: 8,
                fontWeight: 700,
                fontFamily: "monospace",
                color: "var(--color-accent-amber)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginTop: 2,
              }}
            >
              Logistics Platform
            </div>
          </div>
        </div>

        <div
          className="ehi-sidebar-brand"
          style={{
            marginTop: 6,
            opacity: isExpanded ? 1 : 0,
            height: isExpanded ? "auto" : 0,
            overflow: "hidden",
            transition:
              "opacity 0.2s ease, height 0.3s cubic-bezier(0.2, 0, 0, 1)",
            whiteSpace: "nowrap",
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: "var(--color-foreground, #F1F5F9)",
            }}
          >
            {user.name}
          </div>
          <div
            style={{
              fontSize: 8.5,
              fontFamily: "monospace",
              color: "var(--color-accent-amber)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginTop: 1,
            }}
          >
            {user.hub}
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: "4px 8px", display: "flex", flexDirection: "column", gap: 2, minHeight: 0 }}>
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              className="group"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: isExpanded ? "flex-start" : "center",
                gap: isExpanded ? 10 : 0,
                padding: isExpanded ? "5px 8px" : "5px",
                background: isActive ? "transparent" : "transparent",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                transition: "background-color 0.15s ease",
                textAlign: "left",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--color-surface-2)"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "var(--radius-sm)",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  flexShrink: 0,
                  background: isActive ? "linear-gradient(135deg, #fde68a 0%, var(--color-accent-amber) 60%, #d97706 100%)" : "transparent",
                  boxShadow: isActive ? "var(--shadow-amber)" : "none",
                  transition: "all 0.15s ease",
                }}
              >
                <Icon
                  size={16}
                  weight={isActive ? "fill" : "regular"}
                  style={{ flexShrink: 0, transition: "all 0.15s ease" }}
                  className={
                    isActive
                      ? "text-[var(--color-obsidian)]"
                      : "text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)]"
                  }
                />
              </div>
              <div
                style={{
                  opacity: isExpanded ? 1 : 0,
                  width: isExpanded ? "auto" : 0,
                  overflow: "hidden",
                  transition:
                    "opacity 0.2s ease, width 0.3s cubic-bezier(0.2, 0, 0, 1)",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <span
                  className={`${isActive ? "text-[var(--color-foreground)]" : "text-[var(--color-muted)] group-hover:text-[var(--color-foreground)]"} transition-colors`}
                  style={{
                    fontSize: 12.5,
                    fontWeight: isActive ? 700 : 500,
                  }}
                >
                  {tab.label}
                </span>
              </div>
            </button>
          );
        })}
      </nav>

      <div
        style={{
          padding: "6px 8px",
          borderTop: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onToggleTheme}
          className="group hover:bg-[var(--color-surface-2)] transition-colors"
          style={{
            width: "100%",
            padding: isExpanded ? "6px 8px" : "6px",
            justifyContent: isExpanded ? "flex-start" : "center",
            background: "transparent",
            border: "none",
            display: "flex",
            alignItems: "center",
            gap: isExpanded ? 10 : 0,
            cursor: "pointer",
            borderRadius: "var(--radius-md)",
          }}
        >
          {theme === "dark" ? (
            <SunIcon
              size={16}
              weight="regular"
              className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-transform duration-300 group-hover:rotate-45 active:scale-90"
            />
          ) : (
            <MoonIcon
              size={16}
              weight="regular"
              className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-transform duration-300 group-hover:-rotate-12 active:scale-90"
            />
          )}
          <div
            style={{
              opacity: isExpanded ? 1 : 0,
              width: isExpanded ? "auto" : 0,
              overflow: "hidden",
              transition:
                "opacity 0.2s ease, width 0.3s cubic-bezier(0.2, 0, 0, 1)",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span
              className="text-left text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors"
              style={{ fontSize: 11.5 }}
            >
              {theme === "dark" ? "Light Mode" : "Dark Mode"}
            </span>
          </div>
        </button>

        <button
          onClick={onLogout}
          className="group hover:bg-[var(--color-surface-2)] transition-colors"
          style={{
            width: "100%",
            padding: isExpanded ? "6px 8px" : "6px",
            justifyContent: isExpanded ? "flex-start" : "center",
            background: "transparent",
            border: "none",
            display: "flex",
            alignItems: "center",
            gap: isExpanded ? 10 : 0,
            cursor: "pointer",
            borderRadius: "var(--radius-md)",
          }}
        >
          <SignOutIcon
            size={16}
            weight="regular"
            className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors"
          />
          <div
            style={{
              opacity: isExpanded ? 1 : 0,
              width: isExpanded ? "auto" : 0,
              overflow: "hidden",
              transition:
                "opacity 0.2s ease, width 0.3s cubic-bezier(0.2, 0, 0, 1)",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span
              className="text-[var(--color-foreground)] group-hover:text-[var(--color-accent-amber)] transition-colors"
              style={{ fontSize: 11.5 }}
            >
              Sign Out
            </span>
          </div>
        </button>
      </div>
    </aside>
  );
};
