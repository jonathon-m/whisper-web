import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enJSON from "./locale/en.json";

const resources = {
  en: { ...enJSON },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "en",
});

export const availableLanguages = Object.keys(resources);
export default i18n;
