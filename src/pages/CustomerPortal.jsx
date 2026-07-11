import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF, formatDate, statusColor } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import SupportTicketForm from "@/components/customer/SupportTicketForm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Plus, Minus, Package, Receipt, Headphones, Loader2 } from "lucide-react";

export default function CustomerPortal() {
  const { customer, user, loading } = useCurrentUser();
  const { toast } = useToast();
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState({});
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (customer) loadData(); else if (!loading) setDataLoading(false); }, [customer, loading]);

  async function loadData() {
    try {
      const [prods, ords, tkts] = await Promise.all([
        base44.entities.Product.filter({ is_active: true, inventory_type: "finished_product" }, "name", 100),
        base44.entities.SalesOrder.filter({ customer_id: customer.id }, "-created_date", 20),
        base44.entities.SupportTicket.filter({ customer_id: customer.id }, "-created_date", 20),
      ]);
      setProducts(prods);
      setOrders(ords);
      setTickets(tkts);
    } catch (e) { console.error(e); }
    finally { setDataLoading(false); }
  }

  function addToCart(p) { setCart(c => ({ ...c, [p.id]: (c[p.id] || 0) + 1 })); }
  function removeFromCart(p) { setCart(c => { const n = (c[p.id] || 0) - 1; const copy = { ...c }; if (n <= 0) delete copy[p.id]; else copy[p.id] = n; return copy; }); }

  const cartItems = Object.entries(cart).map(([id, qty]) => {
    const p = products.find(x => x.id === id);
    return { product: p, qty, lineTotal: (p?.selling_price || 0) * qty };
  }).filter(i => i.product);
  const cartTotal = cartItems.reduce((s, i) => s + i.lineTotal, 0);

  async function submitOrder() {
    if (cartItems.length === 0) return;
    setSubmitting(true);
    try {
      const count = await base44.entities.SalesRequest.filter({ customer_id: customer.id });
      const num = (count?.length || 0) + 1;
      const items_json = JSON.stringify(cartItems.map(i => ({
        product_id: i.product.id, product_name: i.product.name,
        quantity: i.qty, unit_price: i.product.selling_price, total: i.lineTotal, unit: i.product.sales_unit || "unit",
      })));
      await base44.entities.SalesRequest.create({
        request_number: `SR-${String(num).padStart(5, "0")}`,
        customer_id: customer.id,
        customer_name: customer.business_name,
        items_json,
        total: cartTotal,
        status: "pending",
        notes: "Submitted from customer portal",
      });
      toast({ title: "Order request sent", description: "Our sales team will confirm your order shortly." });
      setCart({});
    } catch (err) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  if (loading || dataLoading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  if (!customer) {
    return (
      <div>
        <PageHeader title="Customer Portal" />
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <Headphones className="mx-auto mb-3 text-slate-300" size={32} />
          <p className="text-slate-600">Your account is not yet linked to a customer profile.</p>
          <p className="text-sm text-slate-400 mt-1">Please contact SOEICAM support to enable portal access.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={`Welcome, ${customer.business_name}`} subtitle="SOEICAM SARL — Customer Portal" />

      <Tabs defaultValue="shop">
        <TabsList className="grid grid-cols-3 mb-6">
          <TabsTrigger value="shop"><ShoppingCart size={14} className="mr-1" /> Shop</TabsTrigger>
          <TabsTrigger value="orders"><Receipt size={14} className="mr-1" /> My Orders</TabsTrigger>
          <TabsTrigger value="support"><Headphones size={14} className="mr-1" /> Support</TabsTrigger>
        </TabsList>

        <TabsContent value="shop">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {products.map(p => (
                  <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-3 flex flex-col">
                    <Package className="text-amber-500 mb-2" size={20} />
                    <p className="text-sm font-medium text-slate-900 line-clamp-2">{p.name}</p>
                    <p className="text-xs text-slate-400 mb-2">{p.size || p.category}</p>
                    <p className="font-semibold text-slate-900 mb-2">{formatXAF(p.selling_price)}</p>
                    <div className="flex items-center gap-1 mt-auto">
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => removeFromCart(p)}><Minus size={12} /></Button>
                      <span className="text-sm w-6 text-center">{cart[p.id] || 0}</span>
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => addToCart(p)}><Plus size={12} /></Button>
                    </div>
                  </div>
                ))}
              </div>
              {products.length === 0 && <p className="text-slate-500 text-center py-8">No products available.</p>}
            </div>

            <div className="lg:sticky lg:top-6 h-fit">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="font-semibold text-slate-900 mb-3">Your Cart</h3>
                {cartItems.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">Cart is empty</p>
                ) : (
                  <>
                    <div className="space-y-2 mb-3">
                      {cartItems.map(i => (
                        <div key={i.product.id} className="flex justify-between text-sm">
                          <span className="text-slate-600">{i.product.name} × {i.qty}</span>
                          <span className="font-medium">{formatXAF(i.lineTotal)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between font-semibold text-slate-900 pt-3 border-t border-slate-100">
                      <span>Total</span><span>{formatXAF(cartTotal)}</span>
                    </div>
                    <Button className="w-full mt-4" onClick={submitOrder} disabled={submitting}>
                      {submitting ? <Loader2 className="animate-spin" /> : <ShoppingCart size={16} />} Submit Order Request
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="orders">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {orders.length === 0 ? (
              <div className="p-8 text-center text-slate-500"><Receipt className="mx-auto mb-2 text-slate-300" size={28} />No orders yet.</div>
            ) : orders.map(o => (
              <div key={o.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-slate-900">{o.order_number}</p>
                  <p className="text-xs text-slate-500">{formatDate(o.order_date)} · {o.payment_type}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{formatXAF(o.total)}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(o.status)}`}>{o.status.replace(/_/g, " ")}</span>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="support">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-900 mb-4">New Support Ticket</h3>
              <SupportTicketForm customer={customer} onSubmitted={() => loadData()} />
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-900 mb-4">Your Tickets</h3>
              {tickets.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">No tickets submitted.</p>
              ) : (
                <div className="space-y-3">
                  {tickets.map(t => (
                    <div key={t.id} className="border border-slate-100 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-slate-900">{t.subject}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(t.status)}`}>{t.status.replace(/_/g, " ")}</span>
                      </div>
                      <p className="text-xs text-slate-500 mb-1">{t.ticket_number} · {t.category.replace(/_/g, " ")}</p>
                      {t.response && <p className="text-xs text-slate-600 bg-slate-50 rounded p-2 mt-1">↳ {t.response}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}