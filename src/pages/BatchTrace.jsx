import React, { useState, useEffect } from "react";
import { searchBatches, traceBackward, traceForward } from "@/lib/traceability";
import PageHeader from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BatchGenealogy from "@/components/quality/BatchGenealogy";
import { Search } from "lucide-react";

export default function BatchTrace() {
  const [term, setTerm] = useState("");
  const [batches, setBatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [back, setBack] = useState(null);
  const [forward, setForward] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { searchBatches(term).then(setBatches); }, [term]);

  async function open(lot) {
    setSelected(lot);
    setLoading(true);
    const [b, f] = await Promise.all([traceBackward(lot.lot_number), traceForward(lot.lot_number)]);
    setBack(b); setForward(f);
    setLoading(false);
  }

  return (
    <div>
      <PageHeader title="Batch Traceability" subtitle="Trace any batch back to its ingredients and forward to the customer" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search batch or product" value={term} onChange={e => setTerm(e.target.value)} />
          </div>
          <div className="max-h-[28rem] overflow-y-auto divide-y divide-slate-100">
            {batches.map(b => (
              <button
                key={b.lot_number}
                onClick={() => open(b)}
                className={`w-full text-left py-2 px-2 rounded hover:bg-slate-50 ${selected?.lot_number === b.lot_number ? "bg-amber-50" : ""}`}
              >
                <p className="font-medium text-slate-900 text-sm">{b.lot_number}</p>
                <p className="text-xs text-slate-500">{b.product_name}</p>
              </button>
            ))}
            {batches.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">No batches found.</p>}
          </div>
        </div>

        <div className="lg:col-span-2">
          {!selected && <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-8 text-center">Select a batch to see its full history.</p>}
          {selected && loading && <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>}
          {selected && !loading && (
            <Tabs defaultValue="backward">
              <TabsList>
                <TabsTrigger value="backward">Where It Came From</TabsTrigger>
                <TabsTrigger value="forward">Where It Went</TabsTrigger>
              </TabsList>
              <TabsContent value="backward" className="mt-4">
                <BatchGenealogy direction="backward" lot={selected} data={back} />
              </TabsContent>
              <TabsContent value="forward" className="mt-4">
                <BatchGenealogy direction="forward" lot={selected} data={forward} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}