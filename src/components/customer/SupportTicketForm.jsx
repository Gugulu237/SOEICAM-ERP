import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Send } from "lucide-react";

const CATEGORIES = [
  { value: "complaint", label: "Complaint" },
  { value: "order_request", label: "Order Request" },
  { value: "billing", label: "Billing" },
  { value: "delivery", label: "Delivery" },
  { value: "product_quality", label: "Product Quality" },
  { value: "other", label: "Other" },
];

export default function SupportTicketForm({ customer, onSubmitted }) {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("other");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!subject || !description) {
      toast({ title: "Missing details", description: "Please add a subject and description", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const count = await base44.entities.SupportTicket.filter({});
      const num = (count?.length || 0) + 1;
      await base44.entities.SupportTicket.create({
        ticket_number: `TKT-${String(num).padStart(5, "0")}`,
        customer_id: customer.id,
        customer_name: customer.business_name,
        subject,
        description,
        category,
        status: "open",
        created_via_portal: true,
      });
      toast({ title: "Ticket submitted", description: "Our team will respond shortly." });
      setSubject(""); setDescription(""); setCategory("other");
      onSubmitted?.();
    } catch (err) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Subject</Label>
        <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Brief summary of your issue" />
      </div>
      <div>
        <Label>Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Description</Label>
        <Textarea rows={5} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe your request in detail..." />
      </div>
      <Button onClick={handleSubmit} disabled={submitting} className="w-full">
        {submitting ? <Loader2 className="animate-spin" /> : <Send size={16} />} Submit Ticket
      </Button>
    </div>
  );
}