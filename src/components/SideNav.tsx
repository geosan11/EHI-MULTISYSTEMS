import { useState, useEffect } from "react";
import ehiLogo from '../assets/branding/ehi-logo.png';
import {
  HouseIcon,
  PackageIcon,
  TrendUpIcon,
  AirplaneIcon,
  QrCodeIcon,
  ArrowLineDownIcon,
  DotsThreeIcon,
  TruckIcon,
  SignOutIcon,
  SunIcon,
  MoonIcon,
} from "@phosphor-icons/react";
import { User, TabView } from "../lib/types";
import { Theme } from "../lib/useTheme";

export const SideNav = ({
  user,
  currentTab,
  onChangeTab,
  onLogout,
  theme,
  onToggleTheme,
}: {
  user: User;
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
  onLogout: () => void;
  theme: Theme;
  onToggleTheme: () => void;
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

  const allTabs: {
    id: TabView;
    icon: any;
    label: string;
    roles: string[];
  }[] = [
    {
      id: "Tower",
      icon: HouseIcon,
      label: "Dashboard",
      roles: [
        "super_admin",
        "admin",
        "cargo_agent",
        "vj_agent",
        "marketing_agent",
        "accountant",
        "auditor",
      ],
    },
    {
      id: "Cargo",
      icon: PackageIcon,
      label: "Cargo Entry",
      roles: ["super_admin", "admin", "cargo_agent", "office_work"],
    },
    {
      id: "Marketing",
      icon: TrendUpIcon,
      label: "Marketing",
      roles: ["super_admin", "admin", "marketing_agent", "office_work"],
    },
    {
      id: "VJ POS",
      icon: AirplaneIcon,
      label: "ValueJet POS",
      roles: ["super_admin", "admin", "vj_agent"],
    },
    {
      id: "Packages",
      icon: TruckIcon,
      label: "Package Desk",
      roles: ["super_admin", "admin", "cargo_agent", "marketing_agent", "office_work"],
    },
    {
      id: "Scan",
      icon: QrCodeIcon,
      label: "QR Scanner",
      roles: [
        "super_admin",
        "admin",
        "cargo_agent",
        "vj_agent",
        "marketing_agent",
        "accountant",
        "auditor",
        "driver",
        "office_work"
      ],
    },
    {
      id: "Incoming",
      icon: ArrowLineDownIcon,
      label: "Incoming To Hub",
      roles: ["super_admin", "admin", "cargo_agent", "vj_agent", "driver", "office_work"],
    },
    { id: "MyTrips", icon: TruckIcon, label: "My Trips", roles: ["driver"] },
    {
      id: "More",
      icon: DotsThreeIcon,
      label: "More",
      roles: ["super_admin", "admin", "accountant", "auditor", "cargo_agent", "vj_agent", "marketing_agent", "driver", "office_work"],
    },
  ];

  const visibleTabs = allTabs.filter((t) => t.roles.includes(user.role));

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
              className={`group ${isActive ? "" : "hover:bg-[rgba(255,255,255,0.02)]"}`}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: isExpanded ? 12 : 0,
                padding: "11px 14px",
                background: "transparent",
                border: "none",
                borderLeft: isActive
                  ? `2px solid ${activeColor}`
                  : "2px solid transparent",
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
              className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors"
            />
          ) : (
            <MoonIcon
              size={18}
              weight="regular"
              className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors"
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
