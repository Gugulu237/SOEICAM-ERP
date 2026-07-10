import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';

// Auth pages
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

// Layout
import AppLayout from '@/components/layout/AppLayout';

// Pages
import Dashboard from '@/pages/Dashboard';
import Accounting from '@/pages/Accounting';
import PaymentForm from '@/pages/PaymentForm';
import Purchases from '@/pages/Purchases';
import PurchaseOrderForm from '@/pages/PurchaseOrderForm';
import GoodsReceiptForm from '@/pages/GoodsReceiptForm';
import Suppliers from '@/pages/Suppliers';
import Inventory from '@/pages/Inventory';
import ProductForm from '@/pages/ProductForm';
import Manufacturing from '@/pages/Manufacturing';
import RecipeForm from '@/pages/RecipeForm';
import ProductionOrderForm from '@/pages/ProductionOrderForm';
import QualityControl from '@/pages/QualityControl';
import Sales from '@/pages/Sales';
import SalesOrderForm from '@/pages/SalesOrderForm';
import Customers from '@/pages/Customers';
import CustomerForm from '@/pages/CustomerForm';
import Distribution from '@/pages/Distribution';
import Employees from '@/pages/Employees';
import Payroll from '@/pages/Payroll';
import Reports from '@/pages/Reports';
import Approvals from '@/pages/Approvals';
import Administration from '@/pages/Administration';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-slate-600 border-t-amber-400 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-amber-400 font-bold text-lg tracking-tight">SOEICAM</p>
          <p className="text-slate-500 text-xs tracking-widest uppercase">YOLA ERP</p>
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounting" element={<Accounting />} />
          <Route path="/accounting/payments/new" element={<PaymentForm />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/purchases/new" element={<PurchaseOrderForm />} />
          <Route path="/purchases/:id" element={<PurchaseOrderForm />} />
          <Route path="/purchases/:id/receive" element={<GoodsReceiptForm />} />
          <Route path="/purchases/receive" element={<Purchases />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory/products/new" element={<ProductForm />} />
          <Route path="/inventory/products/:id" element={<ProductForm />} />
          <Route path="/manufacturing" element={<Manufacturing />} />
          <Route path="/manufacturing/new" element={<ProductionOrderForm />} />
          <Route path="/manufacturing/:id" element={<ProductionOrderForm />} />
          <Route path="/manufacturing/recipes/new" element={<RecipeForm />} />
          <Route path="/manufacturing/recipes/:id" element={<RecipeForm />} />
          <Route path="/quality" element={<QualityControl />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/sales/new" element={<SalesOrderForm />} />
          <Route path="/sales/:id" element={<SalesOrderForm />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/new" element={<CustomerForm />} />
          <Route path="/customers/:id" element={<CustomerForm />} />
          <Route path="/distribution" element={<Distribution />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/payroll" element={<Payroll />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/admin" element={<Administration />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App