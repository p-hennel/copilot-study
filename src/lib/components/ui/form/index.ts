import * as FormPrimitive from "formsnap";
import Description from "./form-description.svelte";
import Label from "./form-label.svelte";
import FieldErrors from "./form-field-errors.svelte";
import Field from "./form-field.svelte";
import Button from "./form-button.svelte";
import Fieldset from "./form-fieldset.svelte";
import Legend from "./form-legend.svelte";
import ElementField from "./form-element-field.svelte";

const Control = FormPrimitive.Control as typeof FormPrimitive.Control;

export {
  Field,
  Control,
  Label,
  FieldErrors,
  Description,
  Fieldset,
  Legend,
  ElementField,
  Button,
  //
  Field as FormField,
  Control as FormControl,
  Description as FormDescription,
  Label as FormLabel,
  FieldErrors as FormFieldErrors,
  Fieldset as FormFieldset,
  Legend as FormLegend,
  ElementField as FormElementField,
  Button as FormButton
};
