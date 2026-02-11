import { useState, useEffect, useRef } from "react";
import type { UserInputRequest, UserInputField, UserInputResponse } from "../extensions";
import "./UserInputForm.css";

interface Props {
  request: UserInputRequest;
  onSubmit: (response: UserInputResponse) => void;
}

export function UserInputForm({ request, onSubmit }: Props) {
  const fields = request.fields ?? [
    { name: "answer", label: request.question, type: "text" as const, required: true },
  ];

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) {
      if (f.type === "confirm") {
        initial[f.name] = f.defaultValue ?? "no";
      } else if (f.type === "select" && f.options?.length) {
        initial[f.name] = f.defaultValue ?? f.options[0];
      } else {
        initial[f.name] = f.defaultValue ?? "";
      }
    }
    return initial;
  });

  const firstInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  const setValue = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const canSubmit = fields
    .filter((f) => f.required)
    .every((f) => values[f.name]?.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) {
      onSubmit(values);
    }
  };

  return (
    <div className="user-input-overlay">
      <form className="user-input-form" onSubmit={handleSubmit}>
        <div className="user-input-header">
          <span className="user-input-icon">💬</span>
          <h2>{request.question}</h2>
        </div>

        {request.description && (
          <p className="user-input-description">{request.description}</p>
        )}

        <div className="user-input-fields">
          {fields.map((field, i) => (
            <FieldInput
              key={field.name}
              field={field}
              value={values[field.name]}
              onChange={(v) => setValue(field.name, v)}
              ref={i === 0 ? firstInputRef : undefined}
            />
          ))}
        </div>

        <button
          type="submit"
          className="user-input-submit"
          disabled={!canSubmit}
        >
          Submit
        </button>
      </form>
    </div>
  );
}

interface FieldInputProps {
  field: UserInputField;
  value: string;
  onChange: (value: string) => void;
  ref?: React.Ref<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
}

function FieldInput({ field, value, onChange, ref }: FieldInputProps) {
  const label = (
    <label className="field-label">
      {field.label}
      {field.required && <span className="field-required">*</span>}
    </label>
  );

  switch (field.type) {
    case "textarea":
      return (
        <div className="field">
          {label}
          <textarea
            ref={ref as React.Ref<HTMLTextAreaElement>}
            className="field-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            rows={4}
          />
        </div>
      );

    case "select":
      return (
        <div className="field">
          {label}
          <select
            ref={ref as React.Ref<HTMLSelectElement>}
            className="field-select"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );

    case "confirm":
      return (
        <div className="field field-confirm">
          {label}
          <div className="confirm-toggle">
            <button
              type="button"
              className={`confirm-btn ${value === "yes" ? "active" : ""}`}
              onClick={() => onChange("yes")}
            >
              Yes
            </button>
            <button
              type="button"
              className={`confirm-btn ${value === "no" ? "active" : ""}`}
              onClick={() => onChange("no")}
            >
              No
            </button>
          </div>
        </div>
      );

    case "text":
    default:
      return (
        <div className="field">
          {label}
          <input
            ref={ref as React.Ref<HTMLInputElement>}
            className="field-input"
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
          />
        </div>
      );
  }
}
