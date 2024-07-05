import * as sdk from "@defillama/sdk";
import { Adapter } from "../adapters/types";
import { CHAIN }from "../helpers/chains";
import { request, gql } from "graphql-request";
import type { ChainEndpoints, FetchOptions } from "../adapters/types"
import { Chain } from '@defillama/sdk/build/general';
import BigNumber from "bignumber.js";
import { getTimestampAtStartOfDay, getTimestampAtStartOfDayUTC } from "../utils/date";

const v1Endpoints = {
  [CHAIN.ETHEREUM]:
    sdk.graph.modifyEndpoint('93yusydMYauh7cfe9jEfoGABmwnX4GffHd7in8KJi1XB'),
}

const v2Endpoints = {
  [CHAIN.ETHEREUM]:
    sdk.graph.modifyEndpoint('Fog6Z9z7DXvWy4bx36c7ETQftdtr4Ppxn7Mjpxkzka2i'),
  [CHAIN.ARBITRUM]:
    sdk.graph.modifyEndpoint('itkjv6Vdh22HtNEPQuk5c9M3T7VeGLQtXxcH8rFi1vc'),
  [CHAIN.POLYGON]:
    sdk.graph.modifyEndpoint('78nZMyM9yD77KG6pFaYap31kJvj8eUWLEntbiVzh8ZKN'),
  [CHAIN.AVAX]:
    sdk.graph.modifyEndpoint('7asfmtQA1KYu6CP7YVm5kv4bGxVyfAHEiptt2HMFgkHu'),
  [CHAIN.XDAI]:
    sdk.graph.modifyEndpoint('EJezH1Cp31QkKPaBDerhVPRWsKVZLrDfzjrLqpmv6cGg'),
  [CHAIN.BASE]:
    "https://api.studio.thegraph.com/query/24660/balancer-base-v2/version/latest",
  [CHAIN.POLYGON_ZKEVM]:
    "https://api.studio.thegraph.com/query/24660/balancer-polygon-zk-v2/version/latest",
  [CHAIN.MODE]:
    "https://api.studio.thegraph.com/query/75376/balancer-mode-v2/version/latest",
  [CHAIN.FRAXTAL]:
    "https://api.goldsky.com/api/public/project_clwhu1vopoigi01wmbn514m1z/subgraphs/balancer-fraxtal-v2/latest/gn"
};

const v1Graphs = (graphUrls: ChainEndpoints) => {
  return (chain: Chain) => {
    return async ({ getFromBlock, getToBlock}: FetchOptions) => {
      const [fromBlock, toBlock] = await Promise.all([getFromBlock(), getToBlock()])

      const graphQuery = gql
        `{
        today: balancer(id: "1", block: { number: ${toBlock} }) {
          totalSwapFee
        }
        yesterday: balancer(id: "1", block: { number: ${fromBlock} }) {
          totalSwapFee
        }
      }`;

      const graphRes = await request(graphUrls[chain], graphQuery);
      const dailyFee = (new BigNumber(graphRes["today"]["totalSwapFee"]).minus(new BigNumber(graphRes["yesterday"]["totalSwapFee"])))

      return {
        totalFees: graphRes["today"]["totalSwapFee"],
        dailyFees: dailyFee.toString(),
        totalUserFees: graphRes["today"]["totalSwapFee"],
        dailyUserFees: dailyFee.toString(),
        totalRevenue: "0",
        dailyRevenue: "0",
        totalProtocolRevenue: "0",
        dailyProtocolRevenue: "0",
        totalSupplySideRevenue: graphRes["today"]["totalSwapFee"],
        dailySupplySideRevenue: dailyFee.toString(),
      };
    };
  };
};
interface IBalancer {
  id: string;
  totalSwapFee: string;
  totalProtocolFee: string;
}

interface IBalancerSnapshot {
  today: IBalancer[];
  yesterday: IBalancer[];
  tenPcFeeChange: {
    totalSwapFee: string;
    totalProtocolFee: string;
    timestamp: number;
  }
  fiftyPcFeeChange: {
    totalSwapFee: string;
    totalProtocolFee: string;
    timestamp: number;
  }
}

const v2Graphs = (graphUrls: ChainEndpoints) => {
  return (chain: Chain) => {
    return async ({ fromTimestamp, toTimestamp}: FetchOptions) => {
      const todayTimestamp = getTimestampAtStartOfDayUTC(toTimestamp);
      const yesterdayTimestamp = getTimestampAtStartOfDayUTC(fromTimestamp);
      const graphQuery = gql
      `query fees {
        today: balancerSnapshots(where: {timestamp:${todayTimestamp}, totalProtocolFee_gt:0}, orderBy: totalProtocolFee, orderDirection: desc) {
          id
          totalSwapFee
          totalProtocolFee
        }
        yesterday: balancerSnapshots(where: {timestamp:${yesterdayTimestamp}, totalProtocolFee_gt:0}, orderBy: totalProtocolFee, orderDirection: desc) {
          id
          totalSwapFee
          totalProtocolFee
        }
        tenPcFeeChange: balancerSnapshot(id: "2-18972") {
          timestamp
        }
        fiftyPcFeeChange: balancerSnapshot(id: "2-19039") {
          timestamp
        }
      }`;

      const graphRes: IBalancerSnapshot = await request(graphUrls[chain], graphQuery);

      let dailySwapFee = new BigNumber(0);
      let dailyProtocolFee = new BigNumber(0);
      if (graphRes["today"].length > 0 && graphRes["yesterday"].length > 0) {
        dailySwapFee = new BigNumber(graphRes["today"][0]["totalSwapFee"]).minus(new BigNumber(graphRes["yesterday"][0]["totalSwapFee"]));
        dailyProtocolFee = new BigNumber(graphRes["today"][0]["totalProtocolFee"]).minus(new BigNumber(graphRes["yesterday"][0]["totalProtocolFee"]));
      }

      let tenPcFeeTimestamp = 0;
      let fiftyPcFeeTimestamp = 0;

      if (chain === CHAIN.ETHEREUM || chain === CHAIN.POLYGON || chain === CHAIN.ARBITRUM) {
        tenPcFeeTimestamp = graphRes["tenPcFeeChange"]["timestamp"]
        fiftyPcFeeTimestamp = graphRes["fiftyPcFeeChange"]["timestamp"]
      }

      // 10% gov vote enabled: https://vote.balancer.fi/#/proposal/0xf6238d70f45f4dacfc39dd6c2d15d2505339b487bbfe014457eba1d7e4d603e3
      // 50% gov vote change: https://vote.balancer.fi/#/proposal/0x03e64d35e21467841bab4847437d4064a8e4f42192ce6598d2d66770e5c51ace
      const dailyFees = toTimestamp < tenPcFeeTimestamp ? "0" : (
        toTimestamp < fiftyPcFeeTimestamp ? dailyProtocolFee.multipliedBy(10) : dailyProtocolFee.multipliedBy(2))

      return {
        dailyUserFees: dailySwapFee.toString(),
        dailyFees: dailyFees.toString(),
        dailyRevenue: dailyProtocolFee.toString(),
        dailyProtocolRevenue: dailyProtocolFee.toString(),
        dailySupplySideRevenue: dailySwapFee.toString(),
      };
    };
  };
};

const methodology = {
  UserFees: "Trading fees paid by users, ranging from 0.0001% to 10%",
  Fees: "All trading fees collected (includes swap and  yield fee)",
  Revenue: "Protocol revenue from all fees collected",
  ProtocolRevenue: "Balancer V2 protocol fees are set to 50%",
  SupplySideRevenue: "A small percentage of the trade paid by traders to pool LPs",
}

const adapter: Adapter = {
  version: 2,
  breakdown: {
    v1: {
      [CHAIN.ETHEREUM]: {
        fetch: v1Graphs(v1Endpoints)(CHAIN.ETHEREUM),
        start: 1582761600,
        meta: {
          methodology: {
            UserFees: "Trading fees paid by users, ranging from 0.0001% and 10%",
            Fees: "All trading fees collected (includes swap and yield fee)",
            Revenue: "Balancer V1 protocol fees are set to 0%",
            ProtocolRevenue: "Balancer V1 protocol fees are set to 0%",
            SupplySideRevenue: "Trading fees are distributed among LPs",
          }
        }
      },
    },
    v2: {
      [CHAIN.ETHEREUM]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.ETHEREUM),
        start: 1619136000,
        meta: {
          methodology
        }
      },
      [CHAIN.POLYGON]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.POLYGON),
        start: 1624492800,
        meta: {
          methodology
        }
      },
      [CHAIN.ARBITRUM]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.ARBITRUM),
        start: 1630368000,
        meta: {
          methodology
        }
      },
      [CHAIN.AVAX]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.AVAX),
        start: 1677283200,
        meta: {
          methodology
        }
      },
      [CHAIN.XDAI]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.XDAI),
        start: 1673308800,
        meta: {
          methodology
        }
      },
      [CHAIN.BASE]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.BASE),
        start: 1690329600,
        meta: {
          methodology
        }
      },
      [CHAIN.POLYGON_ZKEVM]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.POLYGON_ZKEVM),
        start: 1686614400,
        meta: {
          methodology
        }
      },
      [CHAIN.MODE]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.MODE),
        start: 1716336000,
        meta: {
          methodology
        }
      },
      [CHAIN.FRAXTAL]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.FRAXTAL),
        start: 1716163200,
        meta: {
          methodology
        }
      },
    }
  }
}

export default adapter;
