"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const BUYER_PERSONAS = [
  "young professional couple",
  "growing family",
  "downsizing empty nesters",
  "luxury investor",
  "first-time homebuyer",
  "serial renovator",
];

const STAGING_AESTHETICS = [
  "Organic Modern Luxury",
  "Warm Transitional",
  "Coastal Minimal",
  "Urban Industrial",
  "Classic Elegant",
];

export default function NewProjectPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<string[]>([""]);
  const [form, setForm] = useState({
    propertyAddress: "",
    clientName: "",
    targetBuyer: "",
    stagingAesthetic: "",
  });

  const handleRoomChange = (index: number, value: string) => {
    const updated = [...rooms];
    updated[index] = value;
    setRooms(updated);
  };

  const addRoom = () => setRooms([...rooms, ""]);

  const removeRoom = (index: number) => {
    if (rooms.length > 1) {
      setRooms(rooms.filter((_, i) => i !== index));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const validRooms = rooms.filter((r) => r.trim() !== "");

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        rooms: validRooms,
      }),
    });

    if (response.ok) {
      const { id } = await response.json();
      router.push(`/projects/${id}`);
    } else {
      const data = await response.json();
      setError(data.error || "Failed to create project");
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-8">
        <h1 className="font-playfair text-3xl font-bold text-stone-800">
          New Project
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          Step 1: Property intake
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="propertyAddress"
            className="block text-sm font-medium text-stone-700"
          >
            Property Address
          </label>
          <input
            id="propertyAddress"
            type="text"
            required
            value={form.propertyAddress}
            onChange={(e) =>
              setForm({ ...form, propertyAddress: e.target.value })
            }
            placeholder="742 Evergreen Terrace, Springfield"
            className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
          />
        </div>

        <div>
          <label
            htmlFor="clientName"
            className="block text-sm font-medium text-stone-700"
          >
            Client Name
          </label>
          <input
            id="clientName"
            type="text"
            required
            value={form.clientName}
            onChange={(e) => setForm({ ...form, clientName: e.target.value })}
            placeholder="Maggie Simpson"
            className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
          />
        </div>

        <div>
          <label
            htmlFor="targetBuyer"
            className="block text-sm font-medium text-stone-700"
          >
            Target Buyer Persona
          </label>
          <select
            id="targetBuyer"
            required
            value={form.targetBuyer}
            onChange={(e) =>
              setForm({ ...form, targetBuyer: e.target.value })
            }
            className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-stone-900 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
          >
            <option value="">Select a buyer persona...</option>
            {BUYER_PERSONAS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="stagingAesthetic"
            className="block text-sm font-medium text-stone-700"
          >
            Staging Aesthetic
          </label>
          <select
            id="stagingAesthetic"
            required
            value={form.stagingAesthetic}
            onChange={(e) =>
              setForm({ ...form, stagingAesthetic: e.target.value })
            }
            className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-stone-900 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
          >
            <option value="">Select an aesthetic...</option>
            {STAGING_AESTHETICS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="room-0"
            className="block text-sm font-medium text-stone-700"
          >
            Rooms
          </label>
          <p className="mt-0.5 text-xs text-stone-500">
            Add each room you will be staging for this property.
          </p>
          <div className="mt-3 space-y-2">
            {rooms.map((room, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  id={`room-${index}`}
                  type="text"
                  value={room}
                  onChange={(e) => handleRoomChange(index, e.target.value)}
                  placeholder="e.g. Primary Bedroom"
                  className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
                />
                {rooms.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRoom(index)}
                    className="rounded-md px-2 py-1.5 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-700"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addRoom}
            className="mt-3 rounded-md border border-dashed border-stone-400 px-3 py-1.5 text-sm text-stone-600 hover:border-stone-500 hover:text-stone-700"
          >
            + Add another room
          </button>
        </div>

        <div className="flex items-center gap-3 pt-4">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-stone-800 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Project"}
          </button>
          <a
            href="/dashboard"
            className="rounded-md px-4 py-2.5 text-sm font-medium text-stone-600 hover:text-stone-800"
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
