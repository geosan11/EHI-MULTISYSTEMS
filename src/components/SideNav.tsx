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

  const activeColor = "var(--color-accent-amber)";

  return (
    <aside
      className={`ehi-sidenav ${isExpanded ? "expanded" : "collapsed"}`}
      style={{
        display: "flex",
        flexDirection: "column",
        width: isExpanded ? 220 : 64,
        background: "var(--color-nav-bg, var(--color-obsidian))",
        borderRight: "1px solid var(--color-nav-border, var(--color-border))",
        flexShrink: 0,
        height: "var(--app-height)",
        overflowY: "auto",
        overflowX: "hidden",
        transition: "width 0.3s cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      {/* Brand */}
      <div
        style={{
          padding: isExpanded ? "20px 12px 16px" : "20px 0 16px",
          borderBottom: "1px solid var(--color-border, var(--color-border))",
          display: "flex",
          flexDirection: "column",
          alignItems: isExpanded ? "flex-start" : "center",
          transition: "all 0.3s cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        <div
          className={`flex items-center cursor-pointer hover:opacity-80 transition-opacity ${isExpanded ? "gap-3" : "justify-center w-full"}`}
          style={{ minHeight: 48 }}
          onClick={handleToggleExpand}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
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
              style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 10 }}
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
                fontSize: 15,
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
                fontSize: 9,
                fontWeight: 700,
                fontFamily: "monospace",
                color: "var(--color-accent-amber)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginTop: 3,
              }}
            >
              Logistics Platform
            </div>
          </div>
        </div>

        <div
          className="ehi-sidebar-brand"
          style={{
            marginTop: 12,
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
              fontSize: 11,
              fontWeight: 600,
              color: "var(--color-foreground, #F1F5F9)",
            }}
          >
            {user.name}
          </div>
          <div
            style={{
              fontSize: 9,
              fontFamily: "monospace",
              color: "var(--color-accent-amber)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginTop: 2,
            }}
          >
            {user.hub}
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: "8px 0" }}>
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              className={`group ${isActive ? "bg-[var(--glow-amber)]" : "hover:bg-[rgba(255,255,255,0.03)]"}`}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: isExpanded ? 12 : 0,
                padding: "11px 14px",
                background: isActive ? "rgba(245, 158, 11, 0.1)" : "transparent",
                border: "none",
                borderLeft: isActive
                  ? `3px solid var(--color-accent-amber)`
                  : "3px solid transparent",
                cursor: "pointer",
                transition: "all 0.15s ease",
                textAlign: "left",
              }}
            >
              <div
                style={{
                  width: 20,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Icon
                  size={isActive ? 20 : 18}
                  weight={isActive ? "duotone" : "regular"}
                  style={{ flexShrink: 0, transition: "all 0.15s ease" }}
                  className={
                    isActive
                      ? "text-[var(--color-accent-amber)]"
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
                  className={`${isActive ? "text-[var(--color-accent-amber)]" : "text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)]"} transition-colors`}
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 500,
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
          padding: "12px 8px",
          borderTop: "1px solid var(--color-border, rgba(255,255,255,0.07))",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        <button
          onClick={onToggleTheme}
          className="group hover:bg-[var(--color-surface-2)] transition-colors"
          style={{
            width: "100%",
            padding: "9px 14px",
            background: "transparent",
            border: "none",
            display: "flex",
            alignItems: "center",
            gap: isExpanded ? 12 : 0,
            cursor: "pointer",
            borderRadius: 6,
          }}
        >
          {theme === "dark" ? (
            <SunIcon
              size={18}
              weight="regular"
              className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-transform duration-300 group-hover:rotate-45 active:scale-90"
            />
          ) : (
            <MoonIcon
              size={18}
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
              style={{ fontSize: 12 }}
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
            padding: "9px 14px",
            background: "transparent",
            border: "none",
            display: "flex",
            alignItems: "center",
            gap: isExpanded ? 12 : 0,
            cursor: "pointer",
            borderRadius: 6,
          }}
        >
          <SignOutIcon
            size={18}
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
              style={{ fontSize: 12 }}
            >
              Sign Out
            </span>
          </div>
        </button>
      </div>
    </aside>
  );
};
