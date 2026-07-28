import { useState } from 'react';
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck, X } from 'lucide-react';
import { useGetIdentity, useLogout, useMenu } from '@refinedev/core';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { AdminRole } from '../api/client';
import { Button, IconButton } from '../ui';
import './refine-admin.css';

type AdminIdentity = { id: string; name: string; role: AdminRole | null };

export function AdminLayout() {
  const { menuItems } = useMenu();
  const { data: identity } = useGetIdentity<AdminIdentity>();
  const { mutate: logout, isPending } = useLogout();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigation = (
    <>
      <div className="admin-refine-brand">
        <span className="admin-refine-brand-mark">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        {!collapsed && (
          <span>
            <strong>ZUTOMAYO CARD</strong>
            <small>Operations Console</small>
          </span>
        )}
      </div>
      <nav className="admin-refine-nav" aria-label="管理後台功能">
        {menuItems.map((item) => {
          const active = location.pathname === item.route || location.pathname.startsWith(`${item.route}/`);
          return (
            <Link
              key={item.key}
              className={`admin-refine-nav-item${active ? ' is-active' : ''}`}
              to={item.route ?? '/admin/cards'}
              title={collapsed ? item.label : undefined}
              onClick={() => setMobileOpen(false)}
            >
              {item.icon}
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="admin-refine-account">
        {!collapsed && (
          <div>
            <strong>{identity?.name ?? '管理員'}</strong>
            <small>{identity?.role ?? 'unknown'}</small>
          </div>
        )}
        <IconButton
          label="登出"
          icon={<LogOut className="size-4" aria-hidden="true" />}
          variant="ghost"
          disabled={isPending}
          onClick={() => logout()}
        />
      </div>
    </>
  );

  return (
    <div className={`admin-refine-shell${collapsed ? ' is-collapsed' : ''}`}>
      <aside className="admin-refine-sidebar">{navigation}</aside>
      {mobileOpen && (
        <button className="admin-refine-scrim" aria-label="關閉選單" onClick={() => setMobileOpen(false)} />
      )}
      <aside className={`admin-refine-mobile-drawer${mobileOpen ? ' is-open' : ''}`}>
        <IconButton
          className="admin-refine-mobile-close"
          label="關閉選單"
          icon={<X className="size-5" aria-hidden="true" />}
          variant="ghost"
          onClick={() => setMobileOpen(false)}
        />
        {navigation}
      </aside>
      <header className="admin-refine-topbar">
        <IconButton
          className="md:hidden"
          label="開啟選單"
          icon={<Menu className="size-5" aria-hidden="true" />}
          variant="ghost"
          onClick={() => setMobileOpen(true)}
        />
        <IconButton
          className="hidden md:inline-flex"
          label={collapsed ? '展開側欄' : '收合側欄'}
          icon={collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          variant="ghost"
          onClick={() => setCollapsed((value) => !value)}
        />
        <span className="min-w-0 flex-1 truncate text-body-sm text-content-muted">管理資料庫與營運工作流</span>
        <Button size="sm" variant="ghost" onClick={() => navigate('/')}>
          查看網站
        </Button>
      </header>
      <main className="admin-refine-content">
        <Outlet />
      </main>
    </div>
  );
}
