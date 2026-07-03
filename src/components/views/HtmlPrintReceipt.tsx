import React from "react";
import { EHILogo } from "../EHILogo";
import { QRCode } from "../QRCode";
import { CargoReceiptData } from "./CargoReceipt";

export const HtmlPrintReceipt = ({ data }: { data: CargoReceiptData }) => {
  return (
    <div className="print-container hidden print:block w-[80mm] p-2 bg-white text-black font-sans">
      <div className="flex items-center justify-between border-b border-black pb-1 mb-1">
        <EHILogo />
        <div className="font-bold text-[12px] uppercase">
          {data.airline || "CARGO"}
        </div>
      </div>

      <div className="text-center font-bold text-[10px] mb-1 uppercase">
        Cargo Entry Receipt
      </div>
      <div className="text-center font-bold text-[9px] mb-1">
        ORIGIN: {data.hubName}
      </div>

      <div className="space-y-0.5 mb-1">
        <div className="flex justify-between">
          <span className="text-[8px] uppercase">Date:</span>{" "}
          <span className="font-bold text-[10px]">{data.date}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[8px] uppercase">Ref:</span>{" "}
          <span className="font-bold text-[10px]">{data.entryRef}</span>
        </div>
      </div>

      <div className="border-t border-black pt-1 mb-1 space-y-0.5">
        <div className="flex justify-between">
          <span className="text-[8px] uppercase">Consignee:</span>{" "}
          <span className="font-bold text-[10px] truncate max-w-[70%]">
            {data.consignee}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[8px] uppercase">AWB/Tag:</span>{" "}
          <span className="font-bold text-[10px]">{data.awbTagNumber}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[8px] uppercase">Pieces:</span>{" "}
          <span className="font-bold text-[10px]">{data.pieces} pcs</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[8px] uppercase">Weight:</span>{" "}
          <span className="font-bold text-[10px]">{Math.round(data.kg)} kg</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[8px] uppercase">Route:</span>{" "}
          <span className="font-bold text-[10px] truncate max-w-[70%]">
            {data.route}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[8px] uppercase">Content:</span>{" "}
          <span className="font-bold text-[10px]">{data.contentType}</span>
        </div>
      </div>

      <div className="border-t border-black py-1 my-1 flex justify-between items-center">
        <span className="text-[8px] uppercase font-bold">Amount Charged:</span>
        <span className="text-[16px] font-bold tracking-tight">
          ₦{data.amount.toLocaleString()}
        </span>
      </div>

      <div className="space-y-0.5 mb-1">
        <div className="flex justify-between">
          <span className="text-[8px] uppercase">Payment Mode:</span>{" "}
          <span className="font-bold text-[10px]">{data.paymentMode}</span>
        </div>
        {data.bankName && (
          <div className="flex justify-between">
            <span className="text-[8px] uppercase">Bank:</span>{" "}
            <span className="font-bold text-[10px] truncate max-w-[70%]">
              {data.bankName}
            </span>
          </div>
        )}
      </div>

      {data.pickupPin && (
        <div className="border border-black p-1 my-1 text-center">
          <div className="text-[8px] uppercase font-bold mb-0.5">
            Pickup PIN
          </div>
          <div className="text-[20px] font-mono font-bold tracking-[0.2em]">
            {data.pickupPin}
          </div>
          <div className="text-[8px]">Consignee must present PIN</div>
        </div>
      )}

      <div className="flex justify-center my-1">
        <QRCode id={data.entryRef} size={70} />
      </div>

      <div className="border-t border-black pt-1 mt-1 text-center">
        <div className="text-[8px]">Logged by: {data.agentName}</div>
        <div className="text-[8px]">Powered by EHI Logistics Platform</div>
      </div>
      <br />
      <br />
      <br />
    </div>
  );
};
