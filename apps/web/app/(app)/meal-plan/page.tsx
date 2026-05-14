import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export const metadata = { title: "Meal Plan" };

export default async function MealPlanPage() {
  const user = await getAutheliaUser();
  await requireHousehold(user);

  return (
    <div className="p-4 lg:p-8">
      <h1 className="mb-6 text-2xl font-bold">Meal Plan</h1>
      <p className="text-muted-foreground">No meal plan yet.</p>
    </div>
  );
}
