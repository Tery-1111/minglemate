import React, { useState } from "react";
import { supabase } from "../supabaseClient";

export default function MpesaCheckout({ userId, amountToPay = 100 }) {
  const [loading, setLoading] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");

  const handlePayment = async (e) => {
    e.preventDefault();
    if (!phoneNumber) return alert("Please enter your M-Pesa phone number");
    
    setLoading(true);

    const intasend = new window.IntaSend({
      publicAPIKey: "ISPubKey_test_your_key_here", 
      live: false
    });

    try {
      intasend.setup({
        amount: amountToPay,
        currency: "KES",
        phone_number: phoneNumber,
        email: "user@minglemate.com"
      });

      intasend.buttons.showProgress();
      const response = await intasend.buttons.pay();
      
      if (response && response.invoice_id) {
        const { error } = await supabase
          .from("payments")
          .insert([
            {
              user_id: userId,
              intasend_invoice_id: response.invoice_id,
              phone_number: phoneNumber,
              amount: amountToPay,
              status: "PROCESSING"
            }
          ]);

        if (error) throw error;
        alert("STK Push sent! Complete the prompt on your phone.");
      }
    } catch (err) {
      console.error(err);
      alert("Payment initiation failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "20px", maxWidth: "350px", margin: "0 auto", border: "1px solid #ccc", borderRadius: "8px" }}>
      <h3>Unlock Premium Matches</h3>
      <p>Amount: KSh {amountToPay}</p>
      <form onSubmit={handlePayment}>
        <input
          type="tel"
          placeholder="e.g. 254712345678"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          style={{ display: "block", width: "100%", padding: "8px", marginBottom: "10px", color: "#000" }}
          required
        />
        <button type="submit" disabled={loading} style={{ width: "100%", padding: "10px", background: "green", color: "white", border: "none", borderRadius: "4px" }}>
          {loading ? "Processing..." : `Pay KSh ${amountToPay} via M-Pesa`}
        </button>
      </form>
    </div>
  );
}
