import React from "react";
import { Outlet } from "react-router-dom";
import AppSidebar from "@/components/layout/AppSidebar";

export default function AppLayout() {
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