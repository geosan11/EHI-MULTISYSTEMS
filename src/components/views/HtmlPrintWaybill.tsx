import React from "react";
import { EHILogo } from "../EHILogo";
import { QRCode } from "../QRCode";
import { CargoReceiptData } from "./CargoReceipt";

export const HtmlPrintWaybill = ({ data }: { data: CargoReceiptData }) => {
  return (
    <div className="print-container hidden print:block w-[100mm] p-2 bg-white text-black font-sans">
      <div className="flex items-center justify-between mb-1">
        <EHILogo />
        <div className="font-bold text-[12px] text-right uppercase leading-tight">
          CARGO
          <br />
          WAYBILL
        </div>
      </div>

      <div className="text-center font-bold text-[18px] border-y-2 border-black py-1 mb-1 uppercase">
        {data.route || "ROUTING"}
      </div>

      <div className="flex justify-between font-bold text-[10px] mb-1 border-b border-black pb-0.5">
        <span>{data.airline}</span>
        <span>AWB: {data.awbTagNumber}</span>
      </div>

      <div className="space-y-0.5 mb-1">
        <div className="flex justify-between">
          <span className="text-[7px] uppercase">Consignee:</span>{" "}
          <span className="font-bold text-[9px] truncate max-w-[70%]">
            {data.consignee}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[7px] uppercase">Pieces:</span>{" "}
          <span className="font-bold text-[9px]">{data.pieces} pcs</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[7px] uppercase">Weight:</span>{" "}
          <span className="font-bold text-[9px]">{data.kg} kg</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[7px] uppercase">Content:</span>{" "}
          <span className="font-bold text-[9px]">{data.contentType}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[7px] uppercase">Date:</span>{" "}
          <span className="font-bold text-[9px]">{data.date}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[7px] uppercase">Ref:</span>{" "}
          <span className="font-bold text-[9px]">{data.entryRef}</span>
        </div>
      </div>

      <div className="flex justify-center my-1">
        <QRCode id={data.entryRef} size={70} />
      </div>

      <div className="border border-black h-[50px] flex items-center justify-center p-1 mt-1">
        <span className="text-[7px] text-gray-500 uppercase">
          Destination Stamp / Signature
        </span>
      </div>
    </div>
  );
};
