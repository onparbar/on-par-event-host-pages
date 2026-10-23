"use client";

import { KITCHEN_STAFF_ROSTER } from "@/lib/kitchen/staff";

export function StaffNameSelect({ id, value, onChange }: { id: string; value: string; onChange: (name: string) => void }) {
  return <label className="staff-name-select" htmlFor={id}>Employee name<select id={id} onChange={(event) => onChange(event.target.value)} value={value}><option value="">Select your name</option>{KITCHEN_STAFF_ROSTER.map((employee) => <option key={employee} value={employee}>{employee}</option>)}</select></label>;
}
