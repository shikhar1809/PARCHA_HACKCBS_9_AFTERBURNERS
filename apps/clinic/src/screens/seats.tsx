import { ClipboardList, HeartPulse, KeyRound, Pill, ReceiptIndianRupee, Stethoscope } from "lucide-react";

/** Each example's seats, to open one directly. */
export const SEATS = [
  {
    name: "Rohini City Hospital",
    accounts: [
      { email: "staff@parcha.test", name: "Hospital management", detail: "Rekha", icon: <KeyRound className="size-5" /> },
      { email: "staff2@parcha.test", name: "Reception", detail: "Anil", icon: <ClipboardList className="size-5" /> },
      { email: "triage@parcha.test", name: "Triage nurse", detail: "Sister Mary", icon: <HeartPulse className="size-5" /> },
      { email: "doctor@parcha.test", name: "Doctor", detail: "Dr. A. Khan", icon: <Stethoscope className="size-5" /> },
      { email: "doctor2@parcha.test", name: "Cardiologist", detail: "Dr. S. Mehta", icon: <Stethoscope className="size-5" /> },
      // Dr. Iyer has not filled in a profile yet: switching to her shows the doctor's first sign-in.
      { email: "doctor3@parcha.test", name: "Paediatrician", detail: "Dr. R. Iyer", icon: <Stethoscope className="size-5" /> },
      { email: "pharmacy@parcha.test", name: "Pharmacy", detail: "Pooja", icon: <Pill className="size-5" /> },
      { email: "billing@parcha.test", name: "Billing desk", detail: "Vikram", icon: <ReceiptIndianRupee className="size-5" /> },
    ],
  },
  {
    name: "Sector 9 Care Hospital",
    accounts: [
      { email: "dwarka.desk@parcha.test", name: "Hospital management", detail: "Sneha", icon: <KeyRound className="size-5" /> },
      { email: "medium.desk@parcha.test", name: "Front desk", detail: "Farhan", icon: <ClipboardList className="size-5" /> },
      { email: "dwarka.doctor@parcha.test", name: "Doctor", detail: "Dr. P. Nair", icon: <Stethoscope className="size-5" /> },
    ],
  },
  {
    name: "Dr. Verma's Clinic",
    accounts: [
      { email: "noida.doctor@parcha.test", name: "Doctor", detail: "Dr. S. Verma", icon: <Stethoscope className="size-5" /> },
    ],
  },
];
