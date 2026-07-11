import React, { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import AppSidebar from "@/components/layout/AppSidebar";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export default function AppLayout() {
  const { role, loading } = useCurrentUser();
  const location = useLocation();
  const navigate = useNavigate();

  // Route drivers and customers straight to their portal from the root dashboard
  useEffect(() => {
    if (loading || !role) return;
    if (location.pathname !== "/") return;
    if (role === "driver") navigate("/driver", { replace: true });
    else if (role === "customer") navigate("/customer", { replace: true });
  }, [role, loading, location.pathname, navigate]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <AppSidebar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}