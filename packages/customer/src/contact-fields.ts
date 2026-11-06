// Shared by the owner form and host validation. CN accepts a complete line1
// without requiring the owner to split it into province and city fields.
export function isRequiredContact(country: string | undefined, field: string) {
  if (field === "line2") return false;
  if (country === "CN")
    return !["email", "city", "region", "postal_code"].includes(field);
  if (country === "US") return field !== "phone";
  return true;
}
