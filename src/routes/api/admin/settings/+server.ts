import { json } from "@sveltejs/kit"
import { AppSettings, settingsSchema } from "$lib/server/settings" // Assuming AppSettings and settingsSchema are exported
import yaml from "js-yaml"
import { ZodError } from "zod"

// GET handler to fetch current settings as YAML
export async function GET({ locals }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 })
  }

  try {
    const settings = AppSettings.getInstance().getSettings()
    const yamlStr = yaml.dump(settings)
    return json({ yaml: yamlStr })
  } catch (error) {
    console.error("Error fetching settings:", error)
    return json({ error: "Failed to fetch settings" }, { status: 500 })
  }
}

// POST handler to update settings from YAML
export async function POST({ request, locals }) {
  if (!locals.session || !locals.user?.id || locals.user.role !== "admin") {
    return json({ error: "Unauthorized!" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const yamlStr = body.yaml

    if (typeof yamlStr !== "string") {
      return json({ error: "Invalid request body, 'yaml' string expected." }, { status: 400 })
    }

    const newSettingsData = yaml.load(yamlStr)

    // Validate the parsed data using the existing schema
    settingsSchema.parse(newSettingsData) // This will throw if validation fails

    // If validation passes, update the settings
    // Note: updateSettings expects a partial object, but we provide the full parsed object.
    // The validation ensures it conforms to the Settings type.
    AppSettings.getInstance().updateSettings(newSettingsData as any) // Use 'as any' if updateSettings expects Partial<Settings>

    return json({ success: true, message: "Settings updated successfully." })
  } catch (error) {
    console.error("Error updating settings:", error)
    if (error instanceof ZodError) {
      return json({ error: "Validation failed", details: error.errors }, { status: 400 })
    }
    if (error instanceof yaml.YAMLException) {
      return json({ error: "Invalid YAML format", details: error.message }, { status: 400 })
    }
    return json({ error: "Failed to update settings" }, { status: 500 })
  }
}
