import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanPaymentRef, cleanRazorpayPage, PAY_MODES } from "../src/counter.js";

test("Razorpay is a way to pay", () => {
  assert.ok(PAY_MODES.includes("razorpay"));
});

test("a Razorpay payment page is an rzp.io or pages.razorpay.com link, nothing else", () => {
  assert.equal(cleanRazorpayPage(" https://rzp.io/rzp/WuRzdD7T "), "https://rzp.io/rzp/WuRzdD7T");
  assert.equal(cleanRazorpayPage("https://pages.razorpay.com/parcha-opd"), "https://pages.razorpay.com/parcha-opd");
  assert.equal(cleanRazorpayPage("http://rzp.io/rzp/WuRzdD7T"), null);
  assert.equal(cleanRazorpayPage("https://rzp.io.evil.example/x"), null);
  assert.equal(cleanRazorpayPage("https://evil.example/rzp.io/x"), null);
  assert.equal(cleanRazorpayPage("javascript:alert(1)"), null);
});

test("a payment id is Razorpay's pay_ form", () => {
  assert.equal(cleanPaymentRef("pay_Q1w2E3r4T5y6U7"), "pay_Q1w2E3r4T5y6U7");
  assert.equal(cleanPaymentRef(" pay_Q1w2E3r4T5y6U7 "), "pay_Q1w2E3r4T5y6U7");
  assert.equal(cleanPaymentRef("12345"), null);
  assert.equal(cleanPaymentRef("pay_<script>"), null);
});
