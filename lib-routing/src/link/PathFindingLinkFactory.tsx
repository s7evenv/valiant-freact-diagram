import * as React from 'react';
import { AbstractLinkFactory, DiagramEngine } from '@projectstorm/react-diagrams-core';
import { PathFindingLinkModel } from './PathFindingLinkModel';
import { PathFindingLinkWidget } from './PathFindingLinkWidget';
import * as _ from 'lodash';
import * as Path from 'paths-js/path';

export class PathFindingLinkFactory extends AbstractLinkFactory<PathFindingLinkModel> {
	ROUTING_SCALING_FACTOR: number = 5;

	// calculated only when smart routing is active
	canvasMatrix: number[][] = [];
	routingMatrix: number[][] = [];

	// used when at least one element has negative coordinates
	hAdjustmentFactor: number = 0;
	vAdjustmentFactor: number = 0;

	static NAME = 'pathfinding';

	constructor() {
		super(PathFindingLinkFactory.NAME);
	}

	generateReactWidget(diagramEngine: DiagramEngine, link: PathFindingLinkModel): JSX.Element {
		return <PathFindingLinkWidget diagramEngine={diagramEngine} link={link} factory={this} />;
	}

	getNewInstance(initialConfig?: any): PathFindingLinkModel {
		return new PathFindingLinkModel();
	}

	/**
	 * A representation of the canvas in the following format:
	 *
	 * +-----------------+
	 * | 0 0 0 0 0 0 0 0 |
	 * | 0 0 0 0 0 0 0 0 |
	 * | 0 0 0 0 0 0 0 0 |
	 * | 0 0 0 0 0 0 0 0 |
	 * | 0 0 0 0 0 0 0 0 |
	 * +-----------------+
	 *
	 * In which all walkable points are marked by zeros.
	 * It uses @link{#ROUTING_SCALING_FACTOR} to reduce the matrix dimensions and improve performance.
	 */
	getCanvasMatrix(): number[][] {
		if (this.canvasMatrix.length === 0) {
			this.calculateCanvasMatrix();
		}

		return this.canvasMatrix;
	}
	calculateCanvasMatrix() {
		const {
			width: canvasWidth,
			hAdjustmentFactor,
			height: canvasHeight,
			vAdjustmentFactor
		} = this.calculateMatrixDimensions();

		this.hAdjustmentFactor = hAdjustmentFactor;
		this.vAdjustmentFactor = vAdjustmentFactor;

		const matrixWidth = Math.ceil(canvasWidth / this.ROUTING_SCALING_FACTOR);
		const matrixHeight = Math.ceil(canvasHeight / this.ROUTING_SCALING_FACTOR);

		this.canvasMatrix = _.range(0, matrixHeight).map(() => {
			return new Array(matrixWidth).fill(0);
		});
	}

	/**
	 * A representation of the canvas in the following format:
	 *
	 * +-----------------+
	 * | 0 0 1 1 0 0 0 0 |
	 * | 0 0 1 1 0 0 1 1 |
	 * | 0 0 0 0 0 0 1 1 |
	 * | 1 1 0 0 0 0 0 0 |
	 * | 1 1 0 0 0 0 0 0 |
	 * +-----------------+
	 *
	 * In which all points blocked by a node (and its ports) are
	 * marked as 1; points were there is nothing (ie, free) receive 0.
	 */
	getRoutingMatrix(): number[][] {
		if (this.routingMatrix.length === 0) {
			this.calculateRoutingMatrix();
		}

		return this.routingMatrix;
	}
	calculateRoutingMatrix(): void {
		const matrix = _.cloneDeep(this.getCanvasMatrix());

		// nodes need to be marked as blocked points
		this.markNodes(matrix);
		// same thing for ports
		this.markPorts(matrix);

		this.routingMatrix = matrix;
	}

	/**
	 * The routing matrix does not have negative indexes, but elements could be negatively positioned.
	 * We use the functions below to translate back and forth between these coordinates, relying on the
	 * calculated values of hAdjustmentFactor and vAdjustmentFactor.
	 */
	translateRoutingX(x: number, reverse: boolean = false) {
		return x + this.hAdjustmentFactor * (reverse ? -1 : 1);
	}
	translateRoutingY(y: number, reverse: boolean = false) {
		return y + this.vAdjustmentFactor * (reverse ? -1 : 1);
	}

	/**
	 * Despite being a long method, we simply iterate over all three collections (nodes, ports and points)
	 * to find the highest X and Y dimensions, so we can build the matrix large enough to contain all elements.
	 */
	calculateMatrixDimensions = (): {
		width: number;
		hAdjustmentFactor: number;
		height: number;
		vAdjustmentFactor: number;
	} => {
		const allNodesCoords = _.values(this.engine.diagramModel.nodes).map(item => ({
			x: item.x,
			width: item.width,
			y: item.y,
			height: item.height
		}));

		const allLinks = _.values(this.engine.diagramModel.links);
		const allPortsCoords = _.flatMap(allLinks.map(link => [link.sourcePort, link.targetPort]))
			.filter(port => port !== null)
			.map(item => ({
				x: item.x,
				width: item.width,
				y: item.y,
				height: item.height
			}));
		const allPointsCoords = _.flatMap(allLinks.map(link => link.points)).map(item => ({
			// points don't have width/height, so let's just use 0
			x: item.x,
			width: 0,
			y: item.y,
			height: 0
		}));

		const canvas = this.engine.canvas as HTMLDivElement;
		const minX =
			Math.floor(
				Math.min(_.minBy(_.concat(allNodesCoords, allPortsCoords, allPointsCoords), item => item.x).x, 0) /
					this.ROUTING_SCALING_FACTOR
			) * this.ROUTING_SCALING_FACTOR;
		const maxXElement = _.maxBy(_.concat(allNodesCoords, allPortsCoords, allPointsCoords), item => item.x + item.width);
		const maxX = Math.max(maxXElement.x + maxXElement.width, canvas.offsetWidth);

		const minY =
			Math.floor(
				Math.min(_.minBy(_.concat(allNodesCoords, allPortsCoords, allPointsCoords), item => item.y).y, 0) /
					this.ROUTING_SCALING_FACTOR
			) * this.ROUTING_SCALING_FACTOR;
		const maxYElement = _.maxBy(
			_.concat(allNodesCoords, allPortsCoords, allPointsCoords),
			item => item.y + item.height
		);
		const maxY = Math.max(maxYElement.y + maxYElement.height, canvas.offsetHeight);

		return {
			width: Math.ceil(Math.abs(minX) + maxX),
			hAdjustmentFactor: Math.abs(minX) / this.ROUTING_SCALING_FACTOR + 1,
			height: Math.ceil(Math.abs(minY) + maxY),
			vAdjustmentFactor: Math.abs(minY) / this.ROUTING_SCALING_FACTOR + 1
		};
	};

	/**
	 * Updates (by reference) where nodes will be drawn on the matrix passed in.
	 */
	markNodes = (matrix: number[][]): void => {
		_.values(this.engine.diagramModel.nodes).forEach(node => {
			const startX = Math.floor(node.x / this.ROUTING_SCALING_FACTOR);
			const endX = Math.ceil((node.x + node.width) / this.ROUTING_SCALING_FACTOR);
			const startY = Math.floor(node.y / this.ROUTING_SCALING_FACTOR);
			const endY = Math.ceil((node.y + node.height) / this.ROUTING_SCALING_FACTOR);

			for (let x = startX - 1; x <= endX + 1; x++) {
				for (let y = startY - 1; y < endY + 1; y++) {
					this.markMatrixPoint(matrix, this.translateRoutingX(x), this.translateRoutingY(y));
				}
			}
		});
	};

	/**
	 * Updates (by reference) where ports will be drawn on the matrix passed in.
	 */
	markPorts = (matrix: number[][]): void => {
		const allElements = _.flatMap(
			_.values(this.engine.diagramModel.links).map(link => [].concat(link.sourcePort, link.targetPort))
		);
		allElements
			.filter(port => port !== null)
			.forEach(port => {
				const startX = Math.floor(port.x / this.ROUTING_SCALING_FACTOR);
				const endX = Math.ceil((port.x + port.width) / this.ROUTING_SCALING_FACTOR);
				const startY = Math.floor(port.y / this.ROUTING_SCALING_FACTOR);
				const endY = Math.ceil((port.y + port.height) / this.ROUTING_SCALING_FACTOR);

				for (let x = startX - 1; x <= endX + 1; x++) {
					for (let y = startY - 1; y < endY + 1; y++) {
						this.markMatrixPoint(matrix, this.translateRoutingX(x), this.translateRoutingY(y));
					}
				}
			});
	};

	markMatrixPoint = (matrix: number[][], x: number, y: number) => {
		if (matrix[y] !== undefined && matrix[y][x] !== undefined) {
			matrix[y][x] = 1;
		}
	};

	generateDynamicPath(pathCoords: number[][]) {
		let path = Path();
		path = path.moveto(pathCoords[0][0] * this.ROUTING_SCALING_FACTOR, pathCoords[0][1] * this.ROUTING_SCALING_FACTOR);
		pathCoords.slice(1).forEach(coords => {
			path = path.lineto(coords[0] * this.ROUTING_SCALING_FACTOR, coords[1] * this.ROUTING_SCALING_FACTOR);
		});
		return path.print();
	}
}
